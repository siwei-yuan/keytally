// 配列几何数据:Think6.5 V3 手绘配列 + 标准幽灵模板(按键数反推用)

import type { GhostKey } from "./types";

export interface LabeledKey {
  x: number;
  y: number;
  w: number;
  label?: string;
}

/// Think6.5 V3(65% ANSI blocker),带键帽字符,仅作轮廓展示
export const KEYS_THINK65: LabeledKey[] = (() => {
  const keys: LabeledKey[] = [];
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

function push(ks: GhostKey[], y: number, defs: [number, number][]) {
  defs.forEach(([x, w]) => ks.push([x, y, w]));
}
function run(ks: GhostKey[], y: number, x0: number, n: number) {
  for (let i = 0; i < n; i++) ks.push([x0 + i, y, 1]);
}

const GHOST_60: GhostKey[] = (() => {
  const ks: GhostKey[] = [];
  run(ks, 0, 0, 13); ks.push([13, 0, 2]);
  push(ks, 1, [[0, 1.5]]); run(ks, 1, 1.5, 12); ks.push([13.5, 1, 1.5]);
  push(ks, 2, [[0, 1.75]]); run(ks, 2, 1.75, 11); ks.push([12.75, 2, 2.25]);
  push(ks, 3, [[0, 2.25]]); run(ks, 3, 2.25, 10); ks.push([12.25, 3, 2.75]);
  push(ks, 4, [[0, 1.25], [1.25, 1.25], [2.5, 1.25], [3.75, 6.25], [10, 1.25], [11.25, 1.25], [12.5, 1.25], [13.75, 1.25]]);
  return ks;
})();

const GHOST_65: GhostKey[] = (() => {
  const ks: GhostKey[] = [];
  run(ks, 0, 0, 13); ks.push([13, 0, 2], [15, 0, 1]);
  push(ks, 1, [[0, 1.5]]); run(ks, 1, 1.5, 12); ks.push([13.5, 1, 1.5], [15, 1, 1]);
  push(ks, 2, [[0, 1.75]]); run(ks, 2, 1.75, 11); ks.push([12.75, 2, 2.25], [15, 2, 1]);
  push(ks, 3, [[0, 2.25]]); run(ks, 3, 2.25, 10); ks.push([12.25, 3, 1.75], [14, 3, 1], [15, 3, 1]);
  push(ks, 4, [[0, 1.25], [1.25, 1.25], [2.5, 1.25], [3.75, 6.25], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1]]);
  return ks;
})();

const GHOST_TKL: GhostKey[] = (() => {
  const ks: GhostKey[] = [];
  ks.push([0, 0, 1]); run(ks, 0, 2, 4); run(ks, 0, 6.5, 4); run(ks, 0, 11, 4); run(ks, 0, 15.25, 3);
  run(ks, 1.5, 0, 13); ks.push([13, 1.5, 2]); run(ks, 1.5, 15.25, 3);
  push(ks, 2.5, [[0, 1.5]]); run(ks, 2.5, 1.5, 12); ks.push([13.5, 2.5, 1.5]); run(ks, 2.5, 15.25, 3);
  push(ks, 3.5, [[0, 1.75]]); run(ks, 3.5, 1.75, 11); ks.push([12.75, 3.5, 2.25]);
  push(ks, 4.5, [[0, 2.25]]); run(ks, 4.5, 2.25, 10); ks.push([12.25, 4.5, 2.75], [16.25, 4.5, 1]);
  push(ks, 5.75, [[0, 1.25], [1.25, 1.25], [2.5, 1.25], [3.75, 6.25], [10, 1.25], [11.25, 1.25], [12.5, 1.25], [13.75, 1.25]]);
  run(ks, 5.75, 15.25, 3);
  return ks;
})();

const GHOST_96: GhostKey[] = (() => {
  const ks: GhostKey[] = [];
  run(ks, 0, 0, 19);
  run(ks, 1, 0, 13); ks.push([13, 1, 2]); run(ks, 1, 15, 4);
  push(ks, 2, [[0, 1.5]]); run(ks, 2, 1.5, 12); ks.push([13.5, 2, 1.5]); run(ks, 2, 15, 4);
  push(ks, 3, [[0, 1.75]]); run(ks, 3, 1.75, 11); ks.push([12.75, 3, 2.25]); run(ks, 3, 15, 4);
  push(ks, 4, [[0, 2.25]]); run(ks, 4, 2.25, 10); ks.push([12.25, 4, 1.75], [14, 4, 1]); run(ks, 4, 15, 4);
  push(ks, 5, [[0, 1.25], [1.25, 1.25], [2.5, 1.25], [3.75, 6.25], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1], [17, 2]]);
  return ks;
})();

function ghost104(): GhostKey[] {
  const ks: GhostKey[] = [...GHOST_TKL];
  const nx = 18.75;
  push(ks, 1.5, [[nx, 1], [nx + 1, 1], [nx + 2, 1], [nx + 3, 1]]);
  push(ks, 2.5, [[nx, 1], [nx + 1, 1], [nx + 2, 1], [nx + 3, 1]]);
  push(ks, 3.5, [[nx, 1], [nx + 1, 1], [nx + 2, 1]]);
  push(ks, 4.5, [[nx, 1], [nx + 1, 1], [nx + 2, 1], [nx + 3, 1]]);
  push(ks, 5.75, [[nx, 2], [nx + 2, 1], [nx + 3, 1]]);
  return ks;
}

/// 按实体键数选最接近的标准配列模板
export function ghostByKeyCount(count: number): { keys: GhostKey[]; label: string } {
  if (count <= 64) return { keys: GHOST_60, label: "60%" };
  if (count <= 72) return { keys: GHOST_65, label: "65%" };
  if (count <= 92) return { keys: GHOST_TKL, label: "TKL 87" };
  if (count <= 101) return { keys: GHOST_96, label: "96%" };
  return { keys: ghost104(), label: "104" };
}

export const GHOST_DEFAULT = GHOST_TKL;

/// profile 的 layout 字段 → 标准模板
export function layoutByName(name: string): GhostKey[] | undefined {
  return { "60": GHOST_60, "65": GHOST_65, "tkl87": GHOST_TKL, "96": GHOST_96, "104": ghost104() }[name];
}
