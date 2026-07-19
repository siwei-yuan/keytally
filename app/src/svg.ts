// SVG 展示原语:全部为纯函数,返回 SVG 字符串。
// 所有灯珠/键帽/括号/辉光只在这里定义一次。

export const OFF = "#2a2c31";
export const INVALID = "#4a4d55";

const GLOW = `<defs><filter id="ktglow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

/// svg 外壳(统一携带辉光滤镜与主题色变量)
export function svgWrap(w: number, h: number, body: string, accent?: string, maxWidth?: number): string {
  const style = [accent ? `--accent:${accent}` : "", maxWidth ? `max-width:${maxWidth}px` : ""].filter(Boolean).join(";");
  return `<svg viewBox="0 0 ${w} ${h}"${style ? ` style="${style}"` : ""}>${GLOW}${body}</svg>`;
}

/// 动画类名(CSS 关键帧挂在这些类上)
export function animCls(a: { breathing?: boolean; blink?: boolean; passthrough?: boolean }): string {
  return [a.breathing ? "breathing" : "", a.blink ? "blink-warn" : "", a.passthrough ? "passthrough" : ""]
    .filter(Boolean)
    .join(" ");
}

export interface LedDotOpts {
  cx: number;
  cy: number;
  color: string;
  r?: number; // 发光体半径,默认 5.5
  cls?: string;
  glow?: boolean;
  /// 提供 idx 则包一层可点选的 .led-hit 组
  idx?: number;
  selected?: boolean;
  accent?: string; // 选中环颜色
}

/// 灯珠 = 挡圈 + 发光体 + 镜面高光(+ 可选选中环)
export function ledDot(o: LedDotOpts): string {
  const r = o.r ?? 5.5;
  const cx = o.cx.toFixed(1), cy = o.cy.toFixed(1);
  const ring = o.selected
    ? `<circle cx="${cx}" cy="${cy}" r="${(r + 4).toFixed(1)}" fill="none" stroke="${o.accent ?? "#e8641b"}" stroke-width="1.5" stroke-dasharray="3 2"/>`
    : "";
  const glow = o.glow ? ' filter="url(#ktglow)"' : "";
  const body =
    `${ring}<circle cx="${cx}" cy="${cy}" r="${(r + 1.5).toFixed(1)}" fill="#0c0b08"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.color}"${glow}/>` +
    `<ellipse cx="${(o.cx - r * 0.33).toFixed(1)}" cy="${(o.cy - r * 0.38).toFixed(1)}" rx="${(r * 0.4).toFixed(1)}" ry="${(r * 0.28).toFixed(1)}" fill="#ffffff50"/>`;
  return o.idx !== undefined
    ? `<g class="${o.cls ?? ""} led-hit" data-idx="${o.idx}">${body}</g>`
    : `<g class="${o.cls ?? ""}">${body}</g>`;
}

export type KeyStyle = "solid" | "ghost" | "uni";

export interface KeyRectOpts {
  x: number;
  y: number;
  w: number;
  h?: number; // 单位 u,默认 1
  u: number; // 像素/键距
  gap?: number;
  pad?: number; // 画布内边距
  style: KeyStyle;
  fill?: string; // uni 模式的整板颜色
  cls?: string;
  label?: string;
}

/// 键帽矩形:solid=暗色实心 / ghost=虚线占位 / uni=整板同色
export function keyRect(o: KeyRectOpts): string {
  const g = o.gap ?? 3, pad = o.pad ?? 4, u = o.u, kh = o.h ?? 1;
  const x = (o.x * u + g / 2 + pad).toFixed(1);
  const y = (o.y * u + g / 2 + pad).toFixed(1);
  const w = (o.w * u - g).toFixed(1);
  const h = (kh * u - g).toFixed(1);
  const styleAttr =
    o.style === "ghost"
      ? `fill="#16171b" stroke="#ffffff1a" stroke-dasharray="4 3"`
      : o.style === "uni"
        ? `class="uni ${o.cls ?? ""}" fill="${o.fill ?? OFF}" stroke="#ffffff14"`
        : `fill="#1b1d21" stroke="#ffffff14"`;
  const rect = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" ${styleAttr}/>`;
  if (!o.label) return rect;
  const tx = ((o.x + o.w / 2) * u + pad).toFixed(1);
  const ty = ((o.y + 0.58) * u + pad).toFixed(1);
  return `<g>${rect}<text x="${tx}" y="${ty}" text-anchor="middle">${o.label}</text></g>`;
}

/// 四角括号(高亮可控灯区的视觉语言)
export function cornerBrackets(x: number, y: number, w: number, h: number, accent: string, margin = 5, len = 9): string {
  const c = (cx: number, cy: number, dx: number, dy: number) =>
    `<path d="M ${cx + dx * len} ${cy} L ${cx} ${cy} L ${cx} ${cy + dy * len}" fill="none" stroke="${accent}" stroke-width="1.5"/>`;
  const x1 = x - margin, y1 = y - margin, x2 = x + w + margin, y2 = y + h + margin;
  return c(x1, y1, 1, 1) + c(x2, y1, -1, 1) + c(x1, y2, 1, -1) + c(x2, y2, -1, -1);
}

/// 键组的外接尺寸(键距单位)
export function keysExtent(keys: readonly (readonly (number | string | undefined)[])[]): { maxX: number; maxY: number } {
  let maxX = 1, maxY = 1;
  for (const k of keys) {
    maxX = Math.max(maxX, (k[0] as number) + (k[2] as number));
    // 第 4 位:BoardData 是高度(数字),GhostKey 是键帽标注(字符串)
    const h = typeof k[3] === "number" ? k[3] : 1;
    maxY = Math.max(maxY, (k[1] as number) + h);
  }
  return { maxX, maxY };
}
