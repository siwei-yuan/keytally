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

export const ACCENTS = ["#D97757", "#10A37F"]; // Claude 珊瑚橙 / Codex 青
const OFF = "#23262d";
const INVALID = "#3a3f48";
const WEEKLY_WARN_PCT = 80;

export interface LedFrame {
  // 6 颗灯的颜色;索引 0 = 数据源指示,1-5 = 进度条(与固件 UL_ACCENT_LED/UL_BAR_LEDS 对应)
  leds: string[];
  breathing: boolean; // 活动模式且干活中:整组呼吸
  blinkAccent: boolean; // 额度模式周限额告警:指示灯闪红
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

  if (!u.valid) {
    return { leds: [INVALID, OFF, OFF, OFF, OFF, OFF], breathing: false, blinkAccent: false, passthrough: false };
  }

  if (mode === 0) {
    const warn = u.weekly_pct !== null && u.weekly_pct >= WEEKLY_WARN_PCT;
    return {
      leds: [accent, ...barColors(u.five_hour_pct, gradeColor)],
      breathing: false,
      blinkAccent: warn,
      passthrough: false,
    };
  }
  if (mode === 1) {
    const pct = budget > 0 ? Math.min(100, (u.today_tokens * 100) / budget) : null;
    return { leds: [accent, ...barColors(pct, () => accent)], breathing: false, blinkAccent: false, passthrough: false };
  }
  // 活动模式
  if (u.active) {
    return { leds: Array(6).fill(accent), breathing: true, blinkAccent: false, passthrough: false };
  }
  return { leds: Array(6).fill(OFF), breathing: false, blinkAccent: false, passthrough: true };
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

export function renderKeyboard(el: HTMLElement, frame: LedFrame, accent: string) {
  const w = 16 * U;
  const h = 5 * U;

  const keyRects = KEYS.map((k) => {
    const label = k.label
      ? `<text x="${(k.x + k.w / 2) * U}" y="${(k.y + 0.58) * U}" text-anchor="middle">${k.label}</text>`
      : "";
    return `<g><rect x="${k.x * U + GAP / 2}" y="${k.y * U + GAP / 2}" width="${k.w * U - GAP}" height="${U - GAP}" rx="5" fill="#1d2026"/>${label}</g>`;
  }).join("");

  // 徽章:挡块区 1u × 2u,内嵌 6 颗 LED(2 列 × 3 行)
  const badge = `<rect x="${BADGE_X * U + GAP / 2}" y="${BADGE_Y * U + GAP / 2}" width="${U - GAP}" height="${2 * U - GAP}" rx="6" fill="#14161a" stroke="#2b2f37"/>`;
  const leds = frame.leds
    .map((color, i) => {
      const col = i % 2;
      const rowi = Math.floor(i / 2);
      const cx = BADGE_X * U + U / 2 + (col - 0.5) * 14;
      const cy = BADGE_Y * U + 16 + rowi * 22;
      const cls = [
        frame.breathing ? "breathing" : "",
        i === 0 && frame.blinkAccent ? "blink-warn" : "",
        frame.passthrough ? "passthrough" : "",
      ].join(" ");
      const glow = color !== OFF && color !== INVALID ? `filter="url(#glow)"` : "";
      return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="6" fill="${color}" ${glow}/>`;
    })
    .join("");

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="--accent:${accent}">
    <defs><filter id="glow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${keyRects}${badge}${leds}
  </svg>`;
}
