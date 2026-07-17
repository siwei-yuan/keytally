// 键盘灯组预览:布局定义 + 颜色映射 + SVG 渲染。
// 颜色映射必须与固件 rgb_matrix 渲染逻辑保持一致(固件是 C 的等价实现)。

export interface Key {
  x: number; // 单位 u
  y: number;
  w: number;
  label?: string;
  role?: "bar1" | "bar2" | "accent";
}

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

// 占位布局:通用 60% ANSI。键盘型号确认后换成按 QMK info.json 生成的真实布局。
// bar1 = 数字排(主进度条),bar2 = QWERTY 排(额度模式的周限额条),accent = Esc。
export const GENERIC_60: Key[] = (() => {
  const keys: Key[] = [];
  const row = (y: number, widths: [string, number][], roles?: Key["role"]) => {
    let x = 0;
    for (const [label, w] of widths) {
      keys.push({ x, y, w, label, role: roles });
      x += w;
    }
  };
  keys.push({ x: 0, y: 0, w: 1, label: "Esc", role: "accent" });
  let x = 1;
  for (const label of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="]) {
    keys.push({ x, y: 0, w: 1, label, role: "bar1" });
    x += 1;
  }
  keys.push({ x, y: 0, w: 2, label: "Bksp" });
  keys.push({ x: 0, y: 1, w: 1.5, label: "Tab" });
  x = 1.5;
  for (const label of ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"]) {
    keys.push({ x, y: 1, w: 1, label, role: "bar2" });
    x += 1;
  }
  keys.push({ x, y: 1, w: 1, label: "[" });
  keys.push({ x: x + 1, y: 1, w: 1, label: "]" });
  keys.push({ x: x + 2, y: 1, w: 1.5, label: "\\" });
  row(2, [["Caps", 1.75], ["A", 1], ["S", 1], ["D", 1], ["F", 1], ["G", 1], ["H", 1], ["J", 1], ["K", 1], ["L", 1], [";", 1], ["'", 1], ["Enter", 2.25]]);
  row(3, [["Shift", 2.25], ["Z", 1], ["X", 1], ["C", 1], ["V", 1], ["B", 1], ["N", 1], ["M", 1], [",", 1], [".", 1], ["/", 1], ["Shift", 2.75]]);
  row(4, [["Ctrl", 1.25], ["Opt", 1.25], ["Cmd", 1.25], ["Space", 6.25], ["Cmd", 1.25], ["Opt", 1.25], ["Fn", 1.25], ["Ctrl", 1.25]]);
  return keys;
})();

const BASE = "#23262d"; // 熄灭
const INVALID = "#3a3f48";
export const ACCENTS = ["#D97757", "#10A37F"]; // Claude 珊瑚橙 / Codex 青

// 0–100 → 绿→黄→红
function gradeColor(pct: number): string {
  const hue = 120 * (1 - Math.min(pct, 100) / 100);
  return `hsl(${hue.toFixed(0)}, 72%, 46%)`;
}

function fillBar(colors: Map<Key, string>, keys: Key[], role: string, pct: number | null) {
  const bar = keys.filter((k) => k.role === role);
  if (pct === null) return;
  const lit = Math.round((Math.min(pct, 100) / 100) * bar.length);
  const c = gradeColor(pct);
  bar.slice(0, lit).forEach((k) => colors.set(k, c));
}

export interface Rendered {
  colors: Map<Key, string>;
  breathing: boolean; // 活动模式且正在干活 → 整板呼吸
  breathColor: string;
}

export function computeColors(
  keys: Key[],
  snap: Snapshot,
  mode: number,
  source: number,
  budget: number
): Rendered {
  const usage = source === 0 ? snap.claude : snap.codex;
  const accent = ACCENTS[source] ?? ACCENTS[0];
  const colors = new Map<Key, string>();
  keys.forEach((k) => colors.set(k, BASE));
  const accentKey = keys.find((k) => k.role === "accent");

  if (!usage.valid) {
    if (accentKey) colors.set(accentKey, INVALID);
    return { colors, breathing: false, breathColor: accent };
  }
  if (accentKey) colors.set(accentKey, accent);

  let breathing = false;
  if (mode === 0) {
    fillBar(colors, keys, "bar1", usage.five_hour_pct);
    fillBar(colors, keys, "bar2", usage.weekly_pct);
  } else if (mode === 1) {
    const pct = budget > 0 ? Math.min(100, (usage.today_tokens * 100) / budget) : null;
    fillBar(colors, keys, "bar1", pct);
  } else if (mode === 2) {
    breathing = usage.active;
    if (usage.active) {
      keys.forEach((k) => colors.set(k, accent));
    }
  }
  return { colors, breathing, breathColor: accent };
}

const U = 44;
const GAP = 4;

export function renderKeyboard(el: HTMLElement, keys: Key[], r: Rendered) {
  const maxX = Math.max(...keys.map((k) => k.x + k.w));
  const maxY = Math.max(...keys.map((k) => k.y)) + 1;
  const w = maxX * U;
  const h = maxY * U;
  const rects = keys
    .map((k) => {
      const color = r.colors.get(k) ?? BASE;
      const label = k.label
        ? `<text x="${(k.x + k.w / 2) * U}" y="${(k.y + 0.58) * U}" text-anchor="middle">${k.label}</text>`
        : "";
      return `<g><rect x="${k.x * U + GAP / 2}" y="${k.y * U + GAP / 2}" width="${k.w * U - GAP}" height="${U - GAP}" rx="6" fill="${color}"/>${label}</g>`;
    })
    .join("");
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" class="${r.breathing ? "breathing" : ""}" style="--breath-color:${r.breathColor}">${rects}</svg>`;
}
