// Think6.5 V3 灯组预览:6 颗 WS2812(右侧挡块徽章区),键帽无 RGB。
// LED 映射逻辑与 firmware/common/usage_lights.c 保持一致。

export interface SourceUsage {
  valid: boolean;
  five_hour_pct: number | null;
  weekly_pct: number | null;
  today_tokens: number;
  active: boolean;
}

export interface Snapshot {
  claude: SourceUsage;
  codex: SourceUsage;
}

export let ACCENTS = ["#D97757", "#10A37F"]; // Claude 珊瑚橙 / Codex 青(可被设置覆盖)
export let WARN_PCT = 80;
export let QUOTA_METRIC = 0; // 0=5h 优先,1=周优先,2=取大
export function applyCustom(claude: string, codex: string, warn: number, metric: number) {
  ACCENTS = [claude, codex];
  WARN_PCT = warn;
  QUOTA_METRIC = metric;
}
const OFF = "#2a2c31";
const INVALID = "#4a4d55";

export interface LedFrame {
  // 6 颗灯的颜色;索引 0 = 数据源指示,1-5 = 进度条(与固件 UL_ACCENT_LED/UL_BAR_LEDS 对应)
  leds: string[];
  breathing: boolean; // 活动模式且干活中:整组呼吸
  blinkAccent: boolean; // 额度模式周限额告警:指示灯闪红(仅 LED 0)
  blinkAll: boolean; // VIA 通用模式的告警:整组闪红
  passthrough: boolean; // 不接管(活动模式空闲):显示用户自己的灯效
}

function gradeColor(pct: number): string {
  const hue = 120 * (1 - Math.min(pct, 100) / 100);
  return `hsl(${hue.toFixed(0)}, 72%, 46%)`;
}

function barColors(pct: number | null, color: (p: number) => string): string[] {
  if (pct === null) return Array(5).fill(OFF);
  const clamped = Math.min(pct, 100);
  let lit = Math.round((clamped * 5) / 100);
  if (clamped > 0 && lit === 0) lit = 1; // 有消耗就至少亮一格(同固件)
  return Array.from({ length: 5 }, (_, i) => (i < lit ? color(clamped) : OFF));
}

export function computeLeds(snap: Snapshot, mode: number, source: number, budget: number): LedFrame {
  const u = source === 0 ? snap.claude : snap.codex;
  const accent = ACCENTS[source] ?? ACCENTS[0];

  const base = { breathing: false, blinkAccent: false, blinkAll: false, passthrough: false };
  if (!u.valid) {
    return { ...base, leds: [INVALID, OFF, OFF, OFF, OFF, OFF] };
  }

  if (mode === 0) {
    const warn = u.weekly_pct !== null && u.weekly_pct >= WARN_PCT;
    return { ...base, leds: [accent, ...barColors(u.five_hour_pct, gradeColor)], blinkAccent: warn };
  }
  if (mode === 1) {
    const pct = budget > 0 ? Math.min(100, (u.today_tokens * 100) / budget) : null;
    return { ...base, leds: [accent, ...barColors(pct, () => accent)] };
  }
  // 活动模式
  if (u.active) {
    return { ...base, leds: Array(6).fill(accent), breathing: true };
  }
  return { ...base, leds: Array(6).fill(OFF), passthrough: true };
}

/// VIA 通用模式 + rgblight 键盘:N 颗灯同色
export function viaLookToFrame(look: ViaLook, n = 6): LedFrame {
  if (look.color === null) {
    return { leds: Array(n).fill(OFF), breathing: false, blinkAccent: false, blinkAll: false, passthrough: true };
  }
  return {
    leds: Array(n).fill(look.color),
    breathing: look.breathing,
    blinkAccent: false,
    blinkAll: look.blinkWarn,
    passthrough: false,
  };
}

// ---- 通用 VIA 模式(整板同色,与 src-tauri compute_via_look 同一套映射) ----

export interface ViaLook {
  color: string | null; // null = passthrough(显示用户自己的灯效)
  blinkWarn: boolean;
  breathing: boolean;
}

export function computeViaLook(snap: Snapshot, mode: number, source: number, budget: number): ViaLook {
  const u = source === 0 ? snap.claude : snap.codex;
  const accent = ACCENTS[source] ?? ACCENTS[0];
  const pass: ViaLook = { color: null, blinkWarn: false, breathing: false };
  if (!u.valid) return pass;
  if (mode === 0) {
    const pct =
      QUOTA_METRIC === 1 ? (u.weekly_pct ?? u.five_hour_pct)
      : QUOTA_METRIC === 2 ? Math.max(u.five_hour_pct ?? -1, u.weekly_pct ?? -1) >= 0
          ? Math.max(u.five_hour_pct ?? 0, u.weekly_pct ?? 0) : null
      : (u.five_hour_pct ?? u.weekly_pct);
    if (pct === null) return pass;
    return {
      color: gradeColor(pct),
      blinkWarn: u.weekly_pct !== null && u.weekly_pct >= WARN_PCT,
      breathing: false,
    };
  }
  if (mode === 1) {
    if (budget <= 0) return pass;
    const pct = Math.min(100, (u.today_tokens * 100) / budget);
    return { color: gradeColor(pct), blinkWarn: false, breathing: false };
  }
  return u.active ? { color: accent, blinkWarn: false, breathing: true } : pass;
}

// ---- 绘制 ----

interface Key {
  x: number;
  y: number;
  w: number;
  label?: string;
}

// 65% ANSI blocker(Think6.5 V3),仅作轮廓展示,键帽无光
const KEYS: Key[] = (() => {
  const keys: Key[] = [];
  const row = (y: number, defs: [string, number][]) => {
    let x = 0;
    for (const [label, w] of defs) {
      keys.push({ x, y, w, label });
      x += w;
    }
  };
  row(0, [["Esc", 1], ["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1], ["6", 1], ["7", 1], ["8", 1], ["9", 1], ["0", 1], ["-", 1], ["=", 1], ["Bksp", 2], ["Del", 1]]);
  row(1, [["Tab", 1.5], ["Q", 1], ["W", 1], ["E", 1], ["R", 1], ["T", 1], ["Y", 1], ["U", 1], ["I", 1], ["O", 1], ["P", 1], ["[", 1], ["]", 1], ["\\", 1.5], ["Home", 1]]);
  row(2, [["Caps", 1.75], ["A", 1], ["S", 1], ["D", 1], ["F", 1], ["G", 1], ["H", 1], ["J", 1], ["K", 1], ["L", 1], [";", 1], ["'", 1], ["Enter", 2.25]]);
  row(3, [["Shift", 2.25], ["Z", 1], ["X", 1], ["C", 1], ["V", 1], ["B", 1], ["N", 1], ["M", 1], [",", 1], [".", 1], ["/", 1], ["Shift", 1.75], ["↑", 1]]);
  row(4, [["Ctrl", 1.25], ["Opt", 1.25], ["Cmd", 1.25], ["Space", 6.25], ["Cmd", 1], ["Fn", 1], ["←", 1], ["↓", 1], ["→", 1]]);
  return keys;
})();

const U = 40;
const GAP = 4;
const BADGE_X = 15; // 右侧挡块(徽章)位置
const BADGE_Y = 2;

/// 通用模式:整板一个颜色(所有键帽/灯带同色)
export function renderUniversal(el: HTMLElement, look: ViaLook, accent: string) {
  const w = 16 * U;
  const h = 5 * U;
  const cls = [look.breathing ? "breathing" : "", look.blinkWarn ? "blink-warn" : "", look.color === null ? "passthrough" : ""].join(" ");
  const fill = look.color ?? "#24262b";
  const keyRects = KEYS.map((k) => {
    const label = k.label
      ? `<text x="${(k.x + k.w / 2) * U}" y="${(k.y + 0.58) * U}" text-anchor="middle">${k.label}</text>`
      : "";
    return `<g><rect class="uni ${cls}" x="${k.x * U + GAP / 2}" y="${k.y * U + GAP / 2}" width="${k.w * U - GAP}" height="${U - GAP}" rx="5" fill="${fill}"/>${label}</g>`;
  }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="--accent:${accent}">${keyRects}</svg>`;
}

export function renderKeyboard(el: HTMLElement, frame: LedFrame, accent: string) {
  const w = 16 * U + 14; // 右侧留白,容纳 LED 区四角括号
  const h = 5 * U;

  const keyRects = KEYS.map((k) => {
    const label = k.label
      ? `<text x="${(k.x + k.w / 2) * U}" y="${(k.y + 0.58) * U}" text-anchor="middle">${k.label}</text>`
      : "";
    return `<g><rect x="${k.x * U + GAP / 2}" y="${k.y * U + GAP / 2}" width="${k.w * U - GAP}" height="${U - GAP}" rx="5" fill="#1b1d21" stroke="#ffffff14"/>${label}</g>`;
  }).join("");

  // 徽章:挡块区 1u × 2u —— 高亮的可控灯区
  const bx = BADGE_X * U + GAP / 2, by = BADGE_Y * U + GAP / 2;
  const bw = U - GAP, bh = 2 * U - GAP, m = 6, t = 10;
  const corner = (cx2: number, cy2: number, dx: number, dy: number) =>
    `<path d="M ${cx2 + dx * t} ${cy2} L ${cx2} ${cy2} L ${cx2} ${cy2 + dy * t}" fill="none" stroke="${accent}" stroke-width="1.5"/>`;
  const badge = `
    ${corner(bx - m, by - m, 1, 1)}${corner(bx + bw + m, by - m, -1, 1)}
    ${corner(bx - m, by + bh + m, 1, -1)}${corner(bx + bw + m, by + bh + m, -1, -1)}
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="5" fill="#0c0d10" stroke="#ffffff22"/>
    <text x="${bx + bw / 2}" y="${by + bh + m + 16}" text-anchor="middle" style="fill:${accent};letter-spacing:2px;font-size:9px">LED</text>`;
  const leds = frame.leds
    .map((color, i) => {
      const col = i % 2;
      const rowi = Math.floor(i / 2);
      const cx = BADGE_X * U + U / 2 + (col - 0.5) * 14;
      const cy = BADGE_Y * U + 16 + rowi * 22;
      const cls = [
        frame.breathing ? "breathing" : "",
        (i === 0 && frame.blinkAccent) || frame.blinkAll ? "blink-warn" : "",
        frame.passthrough ? "passthrough" : "",
      ].join(" ");
      const glow = !frame.passthrough && color !== OFF && color !== INVALID ? `filter="url(#glow)"` : "";
      return `<g class="${cls}"><circle cx="${cx}" cy="${cy}" r="7.5" fill="#0c0b08"/><circle cx="${cx}" cy="${cy}" r="6" fill="${color}" ${glow}/><ellipse cx="${cx - 2}" cy="${cy - 2.2}" rx="2.2" ry="1.6" fill="#ffffff55"/></g>`;
    })
    .join("");

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="--accent:${accent}">
    <defs><filter id="glow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${keyRects}${badge}${leds}
  </svg>`;
}

/// 通用 rgblight 灯带(不知道物理位置的键盘):一排 N 颗灯
export function renderStrip(el: HTMLElement, frame: LedFrame, accent: string, name: string) {
  const n = frame.leds.length;
  const sp = 34;
  const w = Math.max(n * sp + 20, 300);
  const dots = frame.leds
    .map((color, i) => {
      const cls = [frame.breathing ? "breathing" : "", frame.blinkAll ? "blink-warn" : "", frame.passthrough ? "passthrough" : ""].join(" ");
      const glow = !frame.passthrough && color !== OFF ? 'filter="url(#glow2)"' : "";
      return `<circle class="${cls}" cx="${20 + i * sp + sp / 2}" cy="45" r="8" fill="${color}" ${glow}/>`;
    })
    .join("");
  el.innerHTML = `<svg viewBox="0 0 ${w} 90" style="--accent:${accent}">
    <defs><filter id="glow2"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <rect x="10" y="25" width="${n * sp + 20}" height="40" rx="10" fill="#26231d" stroke="#8a8270"/>
    <text x="${w / 2}" y="16" text-anchor="middle">${name} · ${n} 灯</text>${dots}
  </svg>`;
}
