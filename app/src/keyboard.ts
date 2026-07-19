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
  leds: string[];
  breathing: boolean; // 活动模式且干活中:整组呼吸
  blinkAccent: boolean; // 额度模式周限额告警:指示灯闪红
  accentIdx: number[]; // 指示灯索引(闪红作用对象)
  blinkAll: boolean; // VIA 通用模式的告警:整组闪红
  passthrough: boolean; // 不接管:显示用户自己的灯效
}

export const DEFAULT_ROLES = [2, 1, 1, 1, 1, 1]; // 0=不参与 1=进度条 2=源指示

function gradeColor(pct: number): string {
  const hue = 120 * (1 - Math.min(pct, 100) / 100);
  return `hsl(${hue.toFixed(0)}, 72%, 46%)`;
}

export function computeLeds(
  snap: Snapshot,
  mode: number,
  source: number,
  budget: number,
  roles: number[] = DEFAULT_ROLES,
  barStyle = 0
): LedFrame {
  const u = source === 0 ? snap.claude : snap.codex;
  const accent = ACCENTS[source] ?? ACCENTS[0];
  const n = roles.length;
  const barIdx = roles.flatMap((r, i) => (r === 1 ? [i] : []));
  const accIdx = roles.flatMap((r, i) => (r === 2 ? [i] : []));
  const base = { breathing: false, blinkAccent: false, accentIdx: accIdx, blinkAll: false, passthrough: false };
  const paint = (barPct: number | null, barColor: (p: number) => string, warn = false): LedFrame => {
    const leds = Array(n).fill(OFF);
    accIdx.forEach((i) => (leds[i] = u.valid ? accent : INVALID));
    if (barPct !== null) {
      const clamped = Math.min(barPct, 100);
      if (barStyle === 1) {
        barIdx.forEach((led) => (leds[led] = barColor(clamped)));
      } else {
        let lit = Math.round((clamped * barIdx.length) / 100);
        if (clamped > 0 && lit === 0) lit = 1;
        barIdx.forEach((led, k) => (leds[led] = k < lit ? barColor(clamped) : OFF));
      }
    }
    return { ...base, leds, blinkAccent: warn };
  };
  if (!u.valid) return paint(null, gradeColor);
  if (mode === 0) {
    return paint(u.five_hour_pct ?? null, gradeColor, u.weekly_pct !== null && u.weekly_pct >= WARN_PCT);
  }
  if (mode === 1) {
    return paint(budget > 0 ? (u.today_tokens * 100) / budget : null, () => accent);
  }
  if (u.active) {
    return { ...base, leds: Array(n).fill(accent), breathing: true };
  }
  return { ...base, leds: Array(n).fill(OFF), passthrough: true };
}

/// VIA 通用模式 + rgblight 键盘:N 颗灯同色
export function viaLookToFrame(look: ViaLook, n = 6): LedFrame {
  if (look.color === null) {
    return { leds: Array(n).fill(OFF), breathing: false, blinkAccent: false, accentIdx: [], blinkAll: false, passthrough: true };
  }
  return {
    leds: Array(n).fill(look.color),
    breathing: look.breathing,
    blinkAccent: false,
    accentIdx: [],
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

export function renderKeyboard(el: HTMLElement, frame: LedFrame, accent: string, selected?: Set<number>) {
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
        (frame.accentIdx.includes(i) && frame.blinkAccent) || frame.blinkAll ? "blink-warn" : "",
        frame.passthrough ? "passthrough" : "",
      ].join(" ");
      const glow = !frame.passthrough && color !== OFF && color !== INVALID ? `filter="url(#glow)"` : "";
      const sel = selected?.has(i)
        ? `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="3 2"/>`
        : "";
      return `<g class="${cls} led-hit" data-idx="${i}">${sel}<circle cx="${cx}" cy="${cy}" r="7.5" fill="#0c0b08"/><circle cx="${cx}" cy="${cy}" r="6" fill="${color}" ${glow}/><ellipse cx="${cx - 2}" cy="${cy - 2.2}" rx="2.2" ry="1.6" fill="#ffffff55"/></g>`;
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

// ---- 数据驱动配列(来自 QMK 数据库) ----

export interface BoardData {
  n: string;
  rl: number;
  keys: [number, number, number, number][]; // x,y,w,h(单位 u)
  leds: [number, number, number][]; // rgb_matrix 灯坐标(0-224 × 0-64)+ flags
}

/// 画真实配列;rgb_matrix 板叠加真实灯点,rgblight 板在下方画灯带示意条
export function renderBoardData(el: HTMLElement, board: BoardData, look: ViaLook, accent: string) {
  const U2 = 36, G = 3;
  const maxX = Math.max(...board.keys.map((k) => k[0] + k[2]), 1);
  const maxY = Math.max(...board.keys.map((k) => k[1] + k[3]), 1);
  const w = maxX * U2 + 8;
  const hasStrip = board.rl > 0 && board.leds.length === 0;
  const stripH = hasStrip ? 46 : 0;
  const h = maxY * U2 + 8 + stripH;
  const cls = [look.breathing ? "breathing" : "", look.blinkWarn ? "blink-warn" : "", look.color === null ? "passthrough" : ""].join(" ");
  const fill = look.color ?? "#24262b";

  // 键帽:rgb_matrix 板整板同色(通用模式所能表达的),rgblight 板键帽无光保持暗色
  const keyFill = board.leds.length > 0 ? fill : "#1b1d21";
  const keyCls = board.leds.length > 0 ? `uni ${cls}` : "";
  const keys = board.keys
    .map(([x, y, kw, kh]) =>
      `<rect class="${keyCls}" x="${(x * U2 + G / 2 + 4).toFixed(1)}" y="${(y * U2 + G / 2 + 4).toFixed(1)}" width="${(kw * U2 - G).toFixed(1)}" height="${(kh * U2 - G).toFixed(1)}" rx="4" fill="${keyFill}" stroke="#ffffff14"/>`
    )
    .join("");

  // rgb_matrix:真实灯点(QMK 坐标系 0-224 × 0-64 映射到板面)
  const ledDots = board.leds
    .map(([lx, ly]) => {
      const cx = 4 + (lx / 224) * maxX * U2;
      const cy = 4 + (ly / 64) * maxY * U2;
      return `<circle class="${cls}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" fill="${look.color ?? OFF}" ${look.color ? 'filter="url(#glow3)"' : ""}/>`;
    })
    .join("");

  // rgblight:底部灯带示意(物理位置未知)
  let strip = "";
  if (hasStrip) {
    const n = board.rl;
    const sy = maxY * U2 + 8 + 24;
    const sp = Math.min(30, (w - 40) / n);
    const dots = Array.from({ length: n }, (_, i) =>
      `<circle class="${cls}" cx="${(20 + i * sp + sp / 2).toFixed(1)}" cy="${sy}" r="6" fill="${look.color ?? OFF}" ${look.color ? 'filter="url(#glow3)"' : ""}/>`
    ).join("");
    strip = `
      <text x="20" y="${sy - 16}" style="letter-spacing:1.5px;font-size:9px">UNDERGLOW ×${n}</text>
      <rect x="12" y="${sy - 12}" width="${n * sp + 16}" height="24" rx="7" fill="#14161a" stroke="#ffffff22"/>${dots}`;
  }

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="--accent:${accent}">
    <defs><filter id="glow3"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${keys}${ledDots}${strip}
  </svg>`;
}
