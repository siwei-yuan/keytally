import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LED_DB } from "./led-db";
import {
  ACCENTS,
  applyCustom,
  computeLeds,
  computeViaLook,
  renderKeyboard,
  renderUniversal,
  viaLookToFrame,
  type Snapshot,
  type SourceUsage,
  renderStrip,
} from "./keyboard";

interface KbState {
  mode: number;
  source: number;
  connected: boolean;
  device_name: string | null;
  backend: string | null;
  lighting: string | null;
  vid: number;
  pid: number;
}

interface AppConfig {
  claude_daily_budget: number;
  codex_daily_budget: number;
  warn_threshold: number;
  quota_metric: number;
  claude_color: string;
  codex_color: string;
}

interface FullState {
  snapshot: Snapshot;
  kb: KbState;
  config: AppConfig;
}

let state: FullState | null = null;

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
  const backendLabel =
    kb.backend === "pro"
      ? "Pro 固件·逐灯"
      : kb.lighting === "rgb_matrix"
        ? "VIA 通用·整板同色"
        : "VIA 通用·灯带同色";
  $("#conn-text").textContent = kb.connected
    ? `已连接:${kb.device_name ?? "QMK 键盘"}(${backendLabel})`
    : "未连接键盘(预览仍实时)";

  for (const btn of document.querySelectorAll<HTMLButtonElement>("#source-seg button")) {
    btn.classList.toggle("active", Number(btn.dataset.source) === kb.source);
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#mode-seg button")) {
    btn.classList.toggle("active", Number(btn.dataset.mode) === kb.mode);
  }

  applyCustom(config.claude_color, config.codex_color, config.warn_threshold, config.quota_metric);
  const budget = kb.source === 0 ? config.claude_daily_budget : config.codex_daily_budget;
  const accent = ACCENTS[kb.source] ?? ACCENTS[0];
  if (kb.backend === "pro") {
    renderKeyboard($("#preview"), computeLeds(snapshot, kb.mode, kb.source, budget), accent);
  } else if (kb.lighting === "rgb_matrix") {
    // 逐键 RGB 键盘:整板同色
    renderUniversal($("#preview"), computeViaLook(snapshot, kb.mode, kb.source, budget), accent);
  } else {
    const key = `${kb.vid.toString(16).padStart(4, "0")}:${kb.pid.toString(16).padStart(4, "0")}`;
    const dev = LED_DB[key];
    const look = computeViaLook(snapshot, kb.mode, kb.source, budget);
    if (!kb.connected || key === "4753:4003") {
      // Think6.5 V3(或未连接时的默认视图):右侧徽章 6 灯
      renderKeyboard($("#preview"), viaLookToFrame(look), look.color ?? accent);
    } else {
      // 其他 rgblight 键盘:按数据库的灯数画通用灯带
      const n = dev?.rl || 6;
      renderStrip($("#preview"), viaLookToFrame(look, n), look.color ?? accent, dev?.n ?? kb.device_name ?? "RGB");
    }
  }

  const u: SourceUsage = kb.source === 0 ? snapshot.claude : snapshot.codex;
  const todayPct = budget > 0 ? (u.today_tokens * 100) / budget : null;
  $("#stats").innerHTML = `
    <div class="stat"><span class="k">5 小时窗口</span><span class="v">${fmtPct(u.five_hour_pct)}</span></div>
    <div class="stat"><span class="k">周限额</span><span class="v">${fmtPct(u.weekly_pct)}</span></div>
    <div class="stat"><span class="k">今日消耗 (tokens)</span><span class="v">${fmtTokens(u.today_tokens)}${todayPct === null ? "" : gaugeHtml(todayPct)}</span></div>
    <div class="stat"><span class="k">状态</span><span class="v">${u.valid ? (u.active ? "🔥干活中" : "空闲") : "未安装"}</span></div>`;
}

const PRO_BOARDS = new Set(["4753:4003"]); // 已适配 Pro 固件的板子(开源后社区扩充)

function renderPro() {
  if (!state) return;
  const { kb } = state;
  const key = `${kb.vid.toString(16).padStart(4, "0")}:${kb.pid.toString(16).padStart(4, "0")}`;
  const statusEl = $("#pro-status");
  const btn = $<HTMLButtonElement>("#upgrade-pro");
  if (!kb.connected) {
    statusEl.textContent = "键盘未连接";
    btn.disabled = true;
  } else if (kb.backend === "pro") {
    statusEl.textContent = "✅ 键盘已运行 Pro 固件";
    btn.disabled = true;
  } else if (PRO_BOARDS.has(key)) {
    statusEl.textContent = "本键盘已有可刷的 Pro 固件";
    btn.disabled = false;
  } else {
    statusEl.textContent = "该型号暂无 Pro 固件(需社区适配)";
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
}

window.addEventListener("DOMContentLoaded", async () => {
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
    invoke("set_config", {
      config: {
        claude_daily_budget: Number($<HTMLInputElement>("#claude-budget").value) || 0,
        codex_daily_budget: Number($<HTMLInputElement>("#codex-budget").value) || 0,
        warn_threshold: Math.min(100, Number($<HTMLInputElement>("#warn-threshold").value) || 80),
        quota_metric: Number($<HTMLSelectElement>("#quota-metric").value) || 0,
        claude_color: $<HTMLInputElement>("#claude-color").value,
        codex_color: $<HTMLInputElement>("#codex-color").value,
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
      $("#pro-progress").textContent = e.payload;
    });
  } catch {
    // 非 Tauri 环境(纯浏览器调 UI)→ 演示数据
    state = {
      snapshot: {
        claude: { valid: true, five_hour_pct: 63, weekly_pct: 17, today_tokens: 2_615_737, active: true },
        codex: { valid: true, five_hour_pct: null, weekly_pct: 1, today_tokens: 0, active: false },
      },
      kb: { mode: 0, source: 0, connected: false, device_name: null, backend: null, lighting: null, vid: 0, pid: 0 },
      config: { claude_daily_budget: 5_000_000, codex_daily_budget: 5_000_000, warn_threshold: 80, quota_metric: 0, claude_color: "#D97757", codex_color: "#10A37F" },
    };
  }
  render();
  renderPro();
  fillSettings();

  $("#backup-keymap").addEventListener("click", async () => {
    try {
      const path = await invoke<string>("backup_keymap");
      $("#pro-progress").textContent = `键位已备份到 ${path}`;
    } catch (e) {
      $("#pro-progress").textContent = `备份失败:${e}`;
    }
  });

  // Tauri WebView 不支持原生 confirm(),用按钮二次确认
  let upgradeArmed: number | null = null;
  $("#upgrade-pro").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("#upgrade-pro");
    if (upgradeArmed === null) {
      btn.textContent = "再点一次,确认改写键盘固件";
      btn.classList.add("armed");
      $("#pro-progress").textContent =
        "将改写键盘固件:备份键位/宏 → 进 DFU → 刷入 → 写回;约 1 分钟,期间键盘短暂失灵,勿拔线。";
      upgradeArmed = window.setTimeout(() => {
        upgradeArmed = null;
        btn.textContent = "刷入 Pro 固件";
        btn.classList.remove("armed");
        $("#pro-progress").textContent = "";
      }, 6000);
      return;
    }
    clearTimeout(upgradeArmed);
    upgradeArmed = null;
    btn.textContent = "刷入 Pro 固件";
    btn.classList.remove("armed");
    try {
      await invoke("upgrade_to_pro");
    } catch (e) {
      $("#pro-progress").textContent = `❌ ${e}`;
    }
  });
});
