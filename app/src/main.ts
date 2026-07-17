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

// 车速表式半圆仪表盘:0 → 100%,指针指示,超 100% 整弧变红
function gaugeSvg(pct: number): string {
  const frac = Math.min(pct, 100) / 100;
  const over = pct >= 100;
  const color = over ? "#d0342c" : `hsl(${(120 * (1 - frac)).toFixed(0)}, 72%, 46%)`;
  const cx = 15, cy = 14, r = 12;
  const arcLen = Math.PI * r;
  // 指针角度:0% 指左,100% 指右
  const t = Math.PI * frac;
  const nx = cx - 8.5 * Math.cos(t), ny = cy - 8.5 * Math.sin(t);
  // 刻度:0/25/50/75/100
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const a = Math.PI * f;
      const x1 = cx - (r - 2) * Math.cos(a), y1 = cy - (r - 2) * Math.sin(a);
      const x2 = cx - r * Math.cos(a), y2 = cy - r * Math.sin(a);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffffff45" stroke-width="1"/>`;
    })
    .join("");
  return `<svg class="gauge" viewBox="0 0 30 17" width="36" height="20" role="img">
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="#25262b" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round"
      stroke-dasharray="${(arcLen * frac).toFixed(1)} ${arcLen.toFixed(1)}"/>
    ${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#e8e6e1" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="1.8" fill="#e8e6e1"/>
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
    <div class="stat"><span class="k">今日消耗</span><span class="v">${fmtTokens(u.today_tokens)}${todayPct === null ? "" : gaugeSvg(todayPct)}</span></div>
    <div class="stat"><span class="k">状态</span><span class="v">${u.valid ? (u.active ? "🔥干活中" : "空闲") : "未安装"}</span></div>`;
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
    });
    state = await invoke<FullState>("get_state");
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
  fillSettings();
});
