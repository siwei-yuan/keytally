// 预览视图:全部基于 svg.ts 原语组装,不重复任何标记。

import { GHOST_DEFAULT } from "./layouts";
import { animCls, cornerBrackets, keyRect, keysExtent, ledDot, svgWrap, OFF } from "./svg";
import type { BoardData, GhostKey, LedFrame, ViaLook } from "./types";

const U_BOARD = 34;

function frameCls(f: LedFrame, i: number): string {
  return animCls({
    breathing: f.breathing,
    blink: (f.accentIdx.includes(i) && f.blinkAccent) || f.blinkAll,
    passthrough: f.passthrough,
  });
}

// ---- 通用模式统一视图:标题 + 配列(上)+ LED 区(下) ----

export interface UniversalViewOpts {
  title: string;
  sub: string;
  board?: BoardData; // 无 = 配列未知,画幽灵模板
  look: ViaLook;
  accent: string;
  stripCount: number; // 0 = 不画下层
  stripLabel: string;
  ghostKeys?: GhostKey[];
  profileLeds?: { x: number; y: number; face?: string }[]; // 社区标定坐标(仅绘制 face=top)
  /// 标定者确认的配列模板(有 = 实心绘制,无问号)
  profileKeys?: GhostKey[];
  /// Pro 固件:逐灯帧(索引 = 链上索引;标定 profile 须把 face=top 的灯排在链序前列)
  frame?: LedFrame;
  /// 板上有逐键背光区(rgb_matrix)→ 键帽整板着色参与显示
  tintKeys?: boolean;
  /// 标题行显示 ⓘ 按钮(点开灯光能力说明弹层;通用模式用)
  info?: boolean;
  tag?: { text: string; kind: string };
}

/// 标定灯珠 + 灯区四角括号与 LED 标注(与 Think 徽章同一视觉语言)
function profileDots(o: UniversalViewOpts, cls: string, pad: number, selected?: Set<number>): string {
  // 侧面/底光暂不绘制(朝向不同,无法画在配列平面上;见 TODO)
  const leds = (o.profileLeds ?? []).filter((L) => !L.face || L.face === "top");
  if (!leds.length) return "";
  const dots = leds
    .map((L, i) => {
      const color = o.frame ? (o.frame.leds[i] ?? OFF) : (o.look.color ?? OFF);
      return ledDot({
        cx: pad + L.x * U_BOARD,
        cy: pad + L.y * U_BOARD,
        color,
        cls: o.frame ? frameCls(o.frame, i) : cls,
        glow: color !== OFF,
        idx: i,
        selected: selected?.has(i),
        accent: o.accent,
      });
    })
    .join("");
  const xs = leds.map((L) => pad + L.x * U_BOARD);
  const ys = leds.map((L) => pad + L.y * U_BOARD);
  const x1 = Math.min(...xs) - 10, y1 = Math.min(...ys) - 10;
  const bw = Math.max(...xs) - Math.min(...xs) + 20, bh = Math.max(...ys) - Math.min(...ys) + 20;
  const label = `<text x="${x1 + bw / 2}" y="${y1 + bh + 16}" text-anchor="middle" style="fill:${o.accent};letter-spacing:2px;font-size:9px">LED</text>`;
  return cornerBrackets(x1, y1, bw, bh, o.accent, 4, 8) + label + dots;
}

/// 画布需容纳超出键区的标定灯珠(如板底 logo 灯、键区右侧的徽章灯)
function ledMaxY(o: UniversalViewOpts): number {
  return Math.max(0, ...(o.profileLeds ?? []).filter((L) => !L.face || L.face === "top").map((L) => L.y + 0.35));
}
function ledMaxX(o: UniversalViewOpts): number {
  return Math.max(0, ...(o.profileLeds ?? []).filter((L) => !L.face || L.face === "top").map((L) => L.x + 0.6));
}

function boardSvg(o: UniversalViewOpts, cls: string, selected?: Set<number>): string {
  const pad = 4;
  if (o.board && o.board.keys.length > 0) {
    const b = o.board;
    const ext = keysExtent(b.keys);
    const maxY = Math.max(ext.maxY, ledMaxY(o));
    const perKey = b.leds.length > 0;
    const tint = perKey || !!o.tintKeys;
    const keys = b.keys
      .map(([x, y, w, h]) =>
        keyRect({ x, y, w, h, u: U_BOARD, pad, style: tint ? "uni" : "solid", fill: o.look.color ?? OFF, cls })
      )
      .join("");
    // 逐键板:灯点在 QMK 登记的真实位置(0-224 × 0-64 → 板面)
    const dots = perKey
      ? b.leds
          .map(([lx, ly]) =>
            ledDot({
              cx: pad + (lx / 224) * ext.maxX * U_BOARD,
              cy: pad + (ly / 64) * ext.maxY * U_BOARD,
              r: 2.6,
              color: o.look.color ?? OFF,
              cls,
              glow: !!o.look.color,
            })
          )
          .join("")
      : "";
    return svgWrap(ext.maxX * U_BOARD + pad * 2, maxY * U_BOARD + pad * 2, keys + dots + profileDots(o, cls, pad, selected));
  }
  // 标定板:配列由标定者确认 → 实心绘制,无占位水印;模板可带键帽标注
  if (o.profileKeys) {
    const tpl = o.profileKeys;
    const ext = keysExtent(tpl);
    const h = (Math.max(ext.maxY, ledMaxY(o)) + 0.55) * U_BOARD + pad * 2; // 余量容纳 LED 标注
    const w = Math.max(ext.maxX, ledMaxX(o)) * U_BOARD + pad * 2;
    const keys = tpl
      .map(([x, y, kw, label]) =>
        keyRect({ x, y, w: kw, u: U_BOARD, pad, style: o.tintKeys ? "uni" : "solid", fill: o.look.color ?? OFF, cls, label })
      )
      .join("");
    return svgWrap(w, h, keys + profileDots(o, cls, pad, selected));
  }
  // 配列未知:键数反推的幽灵模板 + 占位水印
  const tpl = o.ghostKeys ?? GHOST_DEFAULT;
  const ext = keysExtent(tpl);
  const h = Math.max(ext.maxY, ledMaxY(o)) * U_BOARD + pad * 2;
  const w = Math.max(ext.maxX, ledMaxX(o)) * U_BOARD + pad * 2;
  const ghost = tpl.map(([x, y, kw]) => keyRect({ x, y, w: kw, u: U_BOARD, pad, style: "ghost" })).join("");
  const mark = `<text x="${w / 2}" y="${h / 2 + 12}" text-anchor="middle" style="font-size:40px;fill:#ffffff12">?</text>`;
  return svgWrap(w, h, ghost + profileDots(o, cls, pad, selected) + mark);
}

/// 下层 LED 区:四角括号 + 一排灯珠
function stripSvg(o: UniversalViewOpts, cls: string, selected?: Set<number>): string {
  const n = o.stripCount;
  const sp = 26, pad = 14, h = 42, m = 5;
  const w = n * sp + pad * 2;
  const dots = Array.from({ length: n }, (_, i) => {
    const color = o.frame ? (o.frame.leds[i] ?? OFF) : (o.look.color ?? OFF);
    return ledDot({
      cx: pad + i * sp + sp / 2,
      cy: h / 2,
      color,
      cls: o.frame ? frameCls(o.frame, i) : cls,
      glow: color !== OFF,
      idx: i,
      selected: selected?.has(i),
      accent: o.accent,
    });
  }).join("");
  const body =
    cornerBrackets(m + 4, m + 3, w - 2 * m - 8, h - 2 * m - 6, o.accent, 4, 9) +
    `<rect x="${m + 4}" y="${m + 3}" width="${w - 2 * m - 8}" height="${h - 2 * m - 6}" rx="8" fill="#14161a" stroke="#ffffff22"/>` +
    dots;
  return svgWrap(w, h, body, undefined, w);
}

export function renderUniversalView(el: HTMLElement, o: UniversalViewOpts, selected?: Set<number>) {
  const cls = animCls({ breathing: o.look.breathing, blink: o.look.blinkWarn, passthrough: o.look.color === null });
  const tag = o.tag ? `<span class="pv-tag pv-tag-${o.tag.kind}">${o.tag.text}</span>` : "";
  const info = o.info ? `<button class="pv-info" type="button" aria-label="info">i</button>` : "";
  const strip = o.stripCount > 0 ? `<div class="pv-leds">${stripSvg(o, cls, selected)}<span class="pv-leds-label">${o.stripLabel}</span></div>` : "";
  el.innerHTML =
    `<div class="pv-title"><span class="pv-name">${o.title}${tag}${info}</span><span class="pv-sub">${o.sub}</span></div>` +
    `<div class="pv-board">${boardSvg(o, cls, selected)}</div>` +
    strip;
}
