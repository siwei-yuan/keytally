import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import LED_DB_JSON from "./led-db.json";
import PROFILES_JSON from "./profiles.json";
import { applyStaticEn, t, trProgress } from "./i18n";
import { ACCENTS, applyCustom, computeLeds, computeViaLook, DEFAULT_ROLES } from "./compute";
import { ghostByKeyCount, layoutByName } from "./layouts";
import { renderUniversalView } from "./views";
import { initLedSelection } from "./select";
import type { BoardData, BoardProfile, FullState, GhostKey, KbState, SourceUsage } from "./types";

const LED_DB = LED_DB_JSON as unknown as Record<string, BoardData>;
const PROFILES = PROFILES_JSON as unknown as Record<string, BoardProfile>;







let state: FullState | null = null;
const ledSel = new Set<number>();
// 库外板:读到的实体键数缓存(-1 = 探测失败)
const keyCountCache = new Map<string, number | "pending">();

function boardKey(kb: KbState): string {
  return `${kb.vid.toString(16).padStart(4, "0")}:${kb.pid.toString(16).padStart(4, "0")}`;
}

function barStyle(): number {
  return state?.config.bar_style ?? 0;
}

function currentRoles(): number[] {
  if (!state) return [...DEFAULT_ROLES];
  const saved = state.config.led_roles?.[boardKey(state.kb)];
  if (saved && saved.length) return [...saved];
  // Pro 固件回报了灯数 → 默认布局按实际灯数生成:第 1 颗指示,其余进度条
  const n = state.kb.led_count;
  if (n > 0) {
    const roles = [2, ...Array(Math.max(n - 1, 0)).fill(1)];
    // 标定 profile 标注的侧/底灯默认不参与显示
    const prof = PROFILES[boardKey(state.kb)];
    if (prof && prof.leds.length === n) {
      prof.leds.forEach((L, i) => {
        if (L.face && L.face !== "top") roles[i] = 0;
      });
    }
    return roles;
  }
  return [...DEFAULT_ROLES];
}

function renderLedPanel() {
  const panel = $("#led-panel");
  // 逐灯职责编辑是 Pro 固件能力;通用模式不提供选灯交互
  if (!state || state.kb.backend !== "pro" || ledSel.size === 0) {
    ledSel.clear();
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const roles = currentRoles();
  const names = [t("不参与", "none"), t("进度条", "bar"), t("源指示", "indicator")];
  const summary = [...ledSel].sort((a, b) => a - b).map((i) => `${i + 1}(${names[roles[i] ?? 0]})`).join(" ");
  $("#led-panel-info").textContent = t(`已选 ${ledSel.size} 颗灯:${summary} → 设为:`, `${ledSel.size} LED(s) selected: ${summary} → set as:`);
  // 选区内所有灯职责一致时,高亮对应按钮
  const uniform = [...ledSel].every((i) => roles[i] === roles[[...ledSel][0]]) ? roles[[...ledSel][0]] : null;
  panel.querySelectorAll<HTMLButtonElement>("button[data-role]").forEach((b) => {
    b.classList.toggle("active", uniform !== null && Number(b.dataset.role) === uniform);
  });
  const hasBar = [...ledSel].some((i) => roles[i] === 1);
  $("#bar-style-row").hidden = !hasBar;
  panel.querySelectorAll<HTMLButtonElement>("button[data-style]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.style) === barStyle());
  });
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

function fmtPct(p: number | null): string {
  return p === null ? "--" : `${p}%`;
}

// 仪表盘:半圆弧浮在百分比数字上方,紧凑单元,互不重叠
function gaugeHtml(pct: number): string {
  const frac = Math.min(pct, 100) / 100;
  const over = pct >= 100;
  const color = over ? "#d0342c" : `hsl(${(120 * (1 - frac)).toFixed(0)}, 72%, 46%)`;
  const cx = 15, cy = 13, r = 11;
  // 半圆:左端 0%,右端 100%(角度从 270°=左 顺时针到 90°=右)
  const polar = (deg: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const arc = (fromDeg: number, sweep: number, stroke: string) => {
    const [x1, y1] = polar(fromDeg);
    const [x2, y2] = polar(fromDeg + sweep);
    const large = sweep > 180 ? 1 : 0;
    return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round"/>`;
  };
  return `<svg class="gauge" viewBox="0 0 30 21" width="30" height="21" role="img">
    ${arc(270, 180, "#25262b")}
    ${frac > 0 ? arc(270, 180 * frac, color) : ""}
    <text x="${cx}" y="18.5" text-anchor="middle"
      style="font-size:7.5px;font-family:var(--mono);fill:${color}">${Math.round(pct)}%</text>
  </svg>`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function render() {
  if (!state) return;
  const { snapshot, kb, config } = state;

  const dot = $("#conn-dot");
  dot.className = `dot ${kb.connected ? "on" : "off"}`;
  const legend = $(".legend");
  if (kb.backend === "pro") {
    legend.innerHTML = `
      <span><i class="chip" style="background:${ACCENTS[kb.source] ?? ACCENTS[0]}"></i>${t("指示灯 = 数据源(额度模式下周限额超阈值时闪红)", "Indicator LED = source (blinks red past weekly threshold in quota mode)")}</span>
      <span><i class="chip grad"></i>${t("进度条灯:额度=5h 用量渐变 / 今日消耗=源色填充 / 活动=整组呼吸", "Bar LEDs: quota=green→red / today=source color fill / activity=breathe")}</span>`;
  } else {
    legend.innerHTML = `
      <span><i class="chip grad"></i>${t("灯色 = 用量 0→100%", "Light color = usage 0→100%")}</span>
      <span><i class="chip" style="background:#e8641b"></i>${t("活动中 = 亮这个颜色", "Active = glows this color")}</span>
      <span><i class="chip warn"></i>${t("红闪 = 周限额超阈值", "Red blink = weekly limit past threshold")}</span>`;
  }
  const backendLabel =
    kb.backend === "pro"
      ? t("Pro 固件·逐灯", "Pro firmware · per-LED")
      : kb.lighting === "rgblight+rgb_matrix"
        ? t("VIA 通用·灯带+全键背光", "Universal VIA · strip + per-key backlight")
        : kb.lighting === "rgb_matrix"
          ? t("VIA 通用·整板同色", "Universal VIA · whole-board")
          : t("VIA 通用·灯带同色", "Universal VIA · light strip");
  $("#conn-text").textContent = kb.connected
    ? t(`已连接:${kb.device_name ?? "QMK 键盘"}(${backendLabel})`, `Connected: ${kb.device_name ?? "QMK keyboard"} (${backendLabel})`)
    : t("未连接键盘", "No keyboard connected");

  for (const btn of document.querySelectorAll<HTMLButtonElement>("#source-seg button")) {
    btn.classList.toggle("active", Number(btn.dataset.source) === kb.source);
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#mode-seg button")) {
    btn.classList.toggle("active", Number(btn.dataset.mode) === kb.mode);
  }

  applyCustom(config.claude_color, config.codex_color, config.warn_threshold, config.quota_metric);
  const budget = kb.source === 0 ? config.claude_daily_budget : config.codex_daily_budget;
  const accent = ACCENTS[kb.source] ?? ACCENTS[0];
  $("#preview").toggleAttribute("data-offline", !kb.connected);
  if (!kb.connected) {
    // 未检测到键盘:无灯的标准 87 配列,整块淡化置灰(样式见 [data-offline])
    $("#preview").removeAttribute("data-editable");
    renderUniversalView($("#preview"), {
      title: t("未连接键盘", "NO KEYBOARD"),
      sub: t("插入带灯的 VIA 键盘即自动识别", "Plug in a VIA keyboard with lights to auto-detect"),
      look: { color: null, blinkWarn: false, breathing: false },
      accent: "#6a6d75",
      stripCount: 0,
      stripLabel: "",
      profileKeys: layoutByName("tkl87"),
      tag: { text: t("离线", "OFFLINE"), kind: "probe" },
    });
  } else if (kb.backend === "pro") {
    $("#preview").setAttribute("data-editable", "");
    const frame = computeLeds(snapshot, kb.mode, kb.source, budget, currentRoles(), barStyle());
    const look = computeViaLook(snapshot, kb.mode, kb.source, budget);
    const proProfile = PROFILES[boardKey(kb)];
    if (proProfile) {
      // 标定板 + Pro 固件:标定视图上逐灯渲染/点选(链序 = profile 中 face=top 灯在前)
      const hidden = proProfile.leds.filter((L) => L.face && L.face !== "top").length;
      renderUniversalView(
        $("#preview"),
        {
          title: (kb.device_name ?? "KEYBOARD").toUpperCase(),
          sub: hidden > 0
            ? t(`Pro 固件 · 点选/框选灯珠指定职责(另 ${hidden} 颗侧/底灯未显示,默认不参与)`, `Pro firmware · click/drag LEDs to assign roles (+${hidden} side/bottom hidden, unassigned by default)`)
            : t("Pro 固件 · 点选/框选灯珠指定职责", "Pro firmware · click/drag LEDs to assign roles"),
          look,
          accent,
          stripCount: 0,
          stripLabel: "",
          profileLeds: proProfile.leds,
          profileKeys: proProfile.layout ? layoutByName(proProfile.layout) : undefined,
          frame,
          tintKeys: kb.matrix_leds > 0 && !(config.matrix_off?.[boardKey(kb)] ?? false),
          tag: { text: t("PRO · 逐灯", "PRO · PER-LED"), kind: "profile" },
        },
        ledSel
      );
    } else {
      // 无标定的 Pro 板:幽灵配列 + 按固件回报灯数画灯带(逐灯可选)
      const n = kb.led_count || 6;
      renderUniversalView(
        $("#preview"),
        {
          title: (kb.device_name ?? "KEYBOARD").toUpperCase(),
          sub: t(`Pro 固件 · 固件报告 ${n} 颗灯 · 点选/框选指定职责(灯位未标定,欢迎提交 profile)`, `Pro firmware · ${n} LEDs reported · click/drag to assign roles (positions uncalibrated — profile PRs welcome)`),
          look,
          accent,
          stripCount: n,
          stripLabel: `LED ×${n}`,
          frame,
          tintKeys: kb.matrix_leds > 0 && !(config.matrix_off?.[boardKey(kb)] ?? false),
          tag: { text: t("PRO · 逐灯", "PRO · PER-LED"), kind: "profile" },
        },
        ledSel
      );
    }
  } else {
    $("#preview").removeAttribute("data-editable");
    const key = boardKey(kb);
    const dev = LED_DB[key];
    const look = computeViaLook(snapshot, kb.mode, kb.source, budget);
    {
      // 能力分级:灯位可知(逐键 RGB,坐标来自 QMK)→ 配列上直接画灯;
      // 不可知(灯带/库外板)→ 上层配列 + 下层 LED 区
      const profile = PROFILES[key];
      const inDb = !!(dev && dev.keys.length > 0);
      const perKey = !!(dev && dev.leds.length > 0);
      // 库外板:通过 VIA 键位表读实体键数,反推标准配列模板
      let kcSub: string | null = null;
      let ghostKeys: GhostKey[] | undefined;
      if (!inDb) {
        const kc = keyCountCache.get(key);
        if (kc === undefined) {
          keyCountCache.set(key, "pending");
          invoke<number>("probe_key_count")
            .then((n) => {
              keyCountCache.set(key, n);
              render();
            })
            .catch(() => keyCountCache.set(key, -1));
        } else if (typeof kc === "number" && kc > 10) {
          const g = ghostByKeyCount(kc);
          ghostKeys = g.keys;
          kcSub = t(`配列未知 · 读到 ${kc} 键,按 ${g.label} 示意`, `Layout unknown · ${kc} keys detected, ${g.label} fallback`);
        }
      }
      renderUniversalView(
        $("#preview"),
        {
          title: (kb.device_name ?? dev?.n ?? "KEYBOARD").toUpperCase(),
          sub: profile
            ? (() => {
                const front = profile.leds.filter((L) => !L.face || L.face === "top").length;
                const hidden = profile.leds.length - front;
                return hidden > 0
                  ? t(`配列与灯位由社区标定 · 正面 ${front} 颗(另 ${hidden} 颗侧/底灯未显示)`, `Community-calibrated · ${front} front LEDs (+${hidden} side/bottom not shown)`)
                  : t(`配列与灯位由社区标定 · ${front} 颗灯`, `Layout & LEDs community-calibrated · ${front} LEDs`);
              })()
            : inDb
              ? perKey
                ? t("逐键 RGB · 灯位来自 QMK 数据库", "Per-key RGB · LED positions from QMK database")
                : t("配列来自 QMK 数据库 · 灯带位置未登记", "Layout from QMK database · strip positions unrecorded")
              : kcSub ?? t("配列未知(固件未上游 QMK)· 示意图", "Layout unknown (firmware not upstreamed) · placeholder"),
          board: inDb ? dev : undefined,
          look,
          accent,
          // 有逐键背光区:键帽整板着色一并参与显示
          tintKeys: kb.zones?.includes("rgb_matrix"),
          info: true,
          // 有标定 profile:灯画在配列上,不画下层灯带
          stripCount: profile ? 0 : perKey ? 0 : dev?.rl || 6,
          stripLabel: dev?.rl
            ? `UNDERGLOW ×${dev.rl}`
            : t("灯数未知 · 示意 6 颗(VIA 协议无灯数查询)", "LED count unknown · showing 6 (VIA has no count query)"),
          ghostKeys,
          profileLeds: profile?.leds,
          profileKeys: profile?.layout ? layoutByName(profile.layout) : undefined,
          tag: profile
            ? { text: t("已标定 · JSON", "CALIBRATED · JSON"), kind: "profile" }
            : inDb
              ? { text: t("QMK 数据库", "QMK DATABASE"), kind: "db" }
              : { text: t("固件反推 · 示意", "PROBED · SKETCH"), kind: "probe" },
        },
        ledSel
      );
    }
  }

  const u: SourceUsage = kb.source === 0 ? snapshot.claude : snapshot.codex;
  const todayPct = budget > 0 ? (u.today_tokens * 100) / budget : null;
  $("#stats").innerHTML = `
    <div class="stat"><span class="k">${t("5 小时窗口", "5-hour window")}</span><span class="v">${fmtPct(u.five_hour_pct)}</span></div>
    <div class="stat"><span class="k">${t("周限额", "Weekly limit")}</span><span class="v">${fmtPct(u.weekly_pct)}</span></div>
    <div class="stat"><span class="k">${t("今日消耗 (tokens)", "Today (tokens)")}</span><span class="v">${fmtTokens(u.today_tokens)}${todayPct === null ? "" : gaugeHtml(todayPct)}</span></div>
    <div class="stat"><span class="k">${t("状态", "Status")}</span><span class="v">${u.valid ? (u.active ? t("🔥干活中", "🔥Working") : t("空闲", "Idle")) : t("未安装", "Not installed")}</span></div>`;
}

const PRO_BOARDS = new Set(["4753:4003", "8101:5352"]); // 已适配 Pro 固件的板子(开源后社区扩充)

function renderPro() {
  if (!state) return;
  const { kb } = state;
  const key = `${kb.vid.toString(16).padStart(4, "0")}:${kb.pid.toString(16).padStart(4, "0")}`;
  const statusEl = $("#pro-status");
  const btn = $<HTMLButtonElement>("#upgrade-pro");
  const restoreBtn = $<HTMLButtonElement>("#restore-stock");
  restoreBtn.disabled = !(kb.connected && kb.backend === "pro");
  if (!kb.connected) {
    statusEl.textContent = t("键盘未连接", "No keyboard connected");
    btn.disabled = true;
  } else if (kb.backend === "pro") {
    statusEl.textContent = t("✅ 键盘已运行 Pro 固件", "✅ Keyboard is running Pro firmware");
    btn.disabled = !PRO_BOARDS.has(key);
    $("#upgrade-label").textContent = t("更新 Pro 固件", "Update Pro firmware");
  } else if (PRO_BOARDS.has(key)) {
    statusEl.textContent = t("本键盘已有可刷的 Pro 固件", "Pro firmware available for this board");
    btn.disabled = false;
  } else {
    statusEl.textContent = t("该型号暂无 Pro 固件(需社区适配)", "No Pro firmware for this model yet (community adaptation welcome)");
    btn.disabled = true;
  }
}

function fillSettings() {
  if (!state) return;
  $<HTMLInputElement>("#claude-budget").value = String(state.config.claude_daily_budget);
  $<HTMLInputElement>("#codex-budget").value = String(state.config.codex_daily_budget);
  $<HTMLInputElement>("#warn-threshold").value = String(state.config.warn_threshold);
  $<HTMLSelectElement>("#quota-metric").value = String(state.config.quota_metric);
  $<HTMLInputElement>("#claude-color").value = state.config.claude_color;
  $<HTMLInputElement>("#codex-color").value = state.config.codex_color;
  $<HTMLInputElement>("#swap-rg").checked = state.config.swap_rg?.[boardKey(state.kb)] ?? false;
  $<HTMLInputElement>("#matrix-on").checked = !(state.config.matrix_off?.[boardKey(state.kb)] ?? false);
  $("#matrix-row").hidden = !(state.kb.zones?.includes("rgb_matrix") || state.kb.matrix_leds > 0);
}

function initInfoModal() {
  $("#info-title").textContent = t("灯光能力说明", "LIGHTING CAPABILITIES");
  $("#info-body").innerHTML = t(
    `<p><b>为什么预览里只有这些灯?</b></p>
     <p>通用模式(免刷机)通过 VIA 协议控制灯光,能控制哪些灯完全取决于键盘固件暴露了什么:</p>
     <ul>
       <li>大多数键盘只把<b>灯条/氛围灯(rgblight)</b>交给 VIA;<b>逐键背光(rgb_matrix)</b>很多固件根本不暴露。例如 Skog Reboot 的原厂固件,92 颗按键背光只能用实体键(F13–F16)控制,任何软件都无法经 VIA 触达。</li>
       <li>VIA 协议没有灯数、灯位查询,也没有逐灯控制,所以通用模式只能<b>整区同色</b>。预览上的灯位来自社区标定或 QMK 数据库(见标题旁的数据来源标签),不是从键盘上读到的。</li>
     </ul>
     <p><b>要控制键盘上的全部灯</b>(含逐键背光、逐灯角色),需要刷入本项目的 <b>Pro 固件</b>(设置 → PRO 区,一键完成,自动备份并写回键位):固件自报灯数、逐灯分配职责、全键背光随用量着色、键盘实体键切换、app 离线 60 秒自动恢复你自己的灯效。</p>
     <hr/>
     <p>目前<b>经完整测试并原生支持</b>的键盘:</p>
     <ul>
       <li>GrayStudio Think6.5 V3</li>
       <li>Percent Skog Reboot</li>
     </ul>
     <p>其他键盘理论上可用但未经充分测试——欢迎社区标定/适配,或直接提一个 issue 请求支持你的键盘(会自动带上当前键盘的识别信息):</p>
     <button id="info-issue" type="button">在 GitHub 提 ISSUE →</button>`,
    `<p><b>Why doesn't the preview show all my lights?</b></p>
     <p>Universal mode (no flashing) drives lighting through the VIA protocol — what can be controlled is entirely up to what the keyboard's firmware exposes:</p>
     <ul>
       <li>Most keyboards only hand their <b>strip/underglow (rgblight)</b> to VIA; <b>per-key backlight (rgb_matrix)</b> is often not exposed at all. On the Skog Reboot's stock firmware, for example, the 92 key backlights are reachable only via hotkeys (F13–F16) — no software can touch them over VIA.</li>
       <li>VIA has no LED-count or LED-position query and no per-LED control, so universal mode is always <b>one color per zone</b>. LED positions in the preview come from community calibration or the QMK database (see the provenance tag next to the title) — never read from the keyboard.</li>
     </ul>
     <p><b>To control every light on the board</b> (per-key backlight, per-LED roles), flash this project's <b>Pro firmware</b> (Settings → PRO, one click, keymap auto-backed-up and restored): the firmware reports its LED count, takes per-LED role assignments, tints the whole backlight with usage, adds keyboard-side switching, and hands your own lighting back 60 s after the app goes offline.</p>
     <hr/>
     <p><b>Fully tested, natively supported boards</b>:</p>
     <ul>
       <li>GrayStudio Think6.5 V3</li>
       <li>Percent Skog Reboot</li>
     </ul>
     <p>Everything else should work but is not extensively tested — community calibrations are welcome, or file an issue to request support for your board (it pre-fills your keyboard's identifiers):</p>
     <button id="info-issue" type="button">FILE A GITHUB ISSUE →</button>`
  );
  const overlay = $("#info-overlay");
  $("#preview").addEventListener("click", (e) => {
    if ((e.target as Element).closest(".pv-info")) overlay.hidden = false;
  });
  $("#info-close").addEventListener("click", () => (overlay.hidden = true));
  $("#info-issue").addEventListener("click", () => {
    const kb = state?.kb;
    const title = encodeURIComponent(`Keyboard support: ${kb?.connected ? (kb.device_name ?? "unknown board") : "<your board>"}`);
    const body = encodeURIComponent(
      [
        `**Board**: ${kb?.connected ? (kb.device_name ?? "unknown") : "<name>"}`,
        `**USB ID**: ${kb?.connected ? boardKey(kb) : "<vid:pid — macOS System Information → USB>"}`,
        `**Detected zones**: ${kb?.connected ? (kb.zones?.join(", ") || kb.lighting || "none") : "<plug it in and check the status line>"}`,
        ``,
        `**What I'd like supported / what looks wrong**:`,
        ``,
      ].join("\n")
    );
    void openUrl(`https://github.com/siwei-yuan/keytally/issues/new?title=${title}&body=${body}`);
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
  if (location.search.includes("info")) overlay.hidden = false; // 调试:?uni&info 直接展开
}

window.addEventListener("DOMContentLoaded", async () => {
  applyStaticEn();
  initInfoModal();
  $("#source-seg").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || !state) return;
    state.kb.source = Number(btn.dataset.source);
    render();
    invoke("set_kb_state", { mode: null, source: state.kb.source });
  });

  $("#mode-seg").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || !state) return;
    state.kb.mode = Number(btn.dataset.mode);
    render();
    invoke("set_kb_state", { mode: state.kb.mode, source: null });
  });

  $("#save-config").addEventListener("click", () => {
    if (!state) return;
    const swapMap = { ...(state.config.swap_rg ?? {}) };
    swapMap[boardKey(state.kb)] = $<HTMLInputElement>("#swap-rg").checked;
    const matrixOffMap = { ...(state.config.matrix_off ?? {}) };
    matrixOffMap[boardKey(state.kb)] = !$<HTMLInputElement>("#matrix-on").checked;
    invoke("set_config", {
      config: {
        ...state.config, // 保留 led_roles / bar_style 等非表单配置
        claude_daily_budget: Number($<HTMLInputElement>("#claude-budget").value) || 0,
        codex_daily_budget: Number($<HTMLInputElement>("#codex-budget").value) || 0,
        warn_threshold: Math.min(100, Number($<HTMLInputElement>("#warn-threshold").value) || 80),
        quota_metric: Number($<HTMLSelectElement>("#quota-metric").value) || 0,
        claude_color: $<HTMLInputElement>("#claude-color").value,
        codex_color: $<HTMLInputElement>("#codex-color").value,
        swap_rg: swapMap,
        matrix_off: matrixOffMap,
      },
    });
  });

  try {
    await listen<FullState>("state", (e) => {
      state = e.payload;
      render();
      renderPro();
    });
    state = await invoke<FullState>("get_state");
    await listen<string>("pro-progress", (e) => {
      $("#pro-progress").textContent = trProgress(e.payload);
    });
  } catch {
    // 非 Tauri 环境(纯浏览器调 UI)→ 演示数据
    state = {
      snapshot: {
        claude: { valid: true, five_hour_pct: 63, weekly_pct: 17, today_tokens: 2_615_737, active: true },
        codex: { valid: true, five_hour_pct: null, weekly_pct: 1, today_tokens: 0, active: false },
      },
      kb: ((): KbState => {
        // 浏览器调试:?pro 模拟 Pro 键盘;?uni 模拟库外灯带板(Skog Reboot)
        const q = location.search;
        const base = { mode: 0, source: 0, connected: false, device_name: null as string | null, backend: null as string | null, lighting: null as string | null, vid: 0x4753, pid: 0x4003, led_count: 0, zones: [] as string[], matrix_leds: 0 };
        if (q.includes("uni"))
          return { ...base, connected: true, device_name: "PERCENT SKOG REBOOT", backend: "via", lighting: "rgblight+rgb_matrix", vid: 0x8101, pid: 0x5352, led_count: 0, zones: ["rgblight", "rgb_matrix"] };
        if (q.includes("proskog"))
          return { ...base, connected: true, device_name: "PERCENT SKOG REBOOT", backend: "pro", lighting: "per-led", vid: 0x8101, pid: 0x5352, led_count: 10, matrix_leds: 92 };
        if (q.includes("pro"))
          return { ...base, connected: true, device_name: "think65v3", backend: "pro", lighting: "per-led", led_count: 6 };
        return base;
      })(),
      config: { claude_daily_budget: 5_000_000, codex_daily_budget: 5_000_000, warn_threshold: 80, quota_metric: 0, claude_color: "#D97757", codex_color: "#10A37F" },
    };
  }
  render();
  renderPro();
  fillSettings();
  if (location.search.includes("settings")) $(".settings").setAttribute("open", "");

  // 灯位选区交互(Pro 模式专属):见 select.ts
  initLedSelection({
    container: $("#preview"),
    enabled: () => state?.kb.backend === "pro",
    selection: ledSel,
    onChange: () => {
      render();
      renderLedPanel();
    },
  });

  $("#led-panel").addEventListener("click", async (e) => {
    const btn = (e.target as Element).closest("button");
    if (!btn || !state) return;
    if (btn.id === "led-clear") {
      ledSel.clear();
    } else if (btn.dataset.style !== undefined) {
      state.config.bar_style = Number(btn.dataset.style);
      invoke("set_led_roles", { roles: currentRoles(), style: Number(btn.dataset.style) });
    } else {
      const role = Number(btn.dataset.role);
      const roles = currentRoles();
      ledSel.forEach((i) => (roles[i] = role));
      state.config.led_roles ??= {};
      state.config.led_roles[boardKey(state.kb)] = roles;
      // 保留选区:按钮高亮 + 摘要更新就是保存成功的确认
      invoke("set_led_roles", { roles, style: barStyle() });
    }
    render();
    renderLedPanel();
  });

  $("#backup-keymap").addEventListener("click", async () => {
    try {
      const path = await invoke<string>("backup_keymap");
      $("#pro-progress").textContent = t(`键位已备份到 ${path}`, `Keymap backed up to ${path}`);
    } catch (e) {
      $("#pro-progress").textContent = t(`备份失败:${e}`, `Backup failed: ${e}`);
    }
  });

  // Tauri WebView 不支持原生 confirm(),用按钮二次确认
  let upgradeArmed: number | null = null;
  $("#restore-stock").addEventListener("click", async () => {
    try {
      await invoke("restore_stock");
    } catch (e) {
      $("#pro-progress").textContent = `❌ ${e}`;
    }
  });

  $("#upgrade-pro").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("#upgrade-pro");
    if (upgradeArmed === null) {
      $("#upgrade-label").textContent = t("再点一次,确认改写键盘固件", "Click again to confirm firmware rewrite");
      btn.classList.add("armed");
      $("#pro-progress").textContent = t(
        "将改写键盘固件:备份键位/宏 → 进 DFU → 刷入 → 写回;约 1 分钟,期间键盘短暂失灵,勿拔线。",
        "This rewrites the keyboard firmware: backup keymap/macros → DFU → flash → restore. ~1 min; keyboard goes dark briefly — don't unplug."
      );
      upgradeArmed = window.setTimeout(() => {
        upgradeArmed = null;
        $("#upgrade-label").textContent = state?.kb.backend === "pro" ? t("更新 Pro 固件", "Update Pro firmware") : t("刷入 Pro 固件", "Flash Pro firmware");
        btn.classList.remove("armed");
        $("#pro-progress").textContent = "";
      }, 6000);
      return;
    }
    clearTimeout(upgradeArmed);
    upgradeArmed = null;
    $("#upgrade-label").textContent = state?.kb.backend === "pro" ? t("更新 Pro 固件", "Update Pro firmware") : t("刷入 Pro 固件", "Flash Pro firmware");
    btn.classList.remove("armed");
    try {
      await invoke("upgrade_to_pro");
    } catch (e) {
      $("#pro-progress").textContent = `❌ ${e}`;
    }
  });
});
