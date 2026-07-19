// 灯效计算(纯逻辑,无 DOM):与固件/后端保持同一套映射。

import { INVALID, OFF } from "./svg";
import type { LedFrame, Snapshot, ViaLook } from "./types";

// 可被设置覆盖的展示参数
export let ACCENTS = ["#D97757", "#10A37F"]; // Claude 珊瑚橙 / Codex 青
export let WARN_PCT = 80;
export let QUOTA_METRIC = 0; // 0=5h 优先,1=周优先,2=取大

export function applyCustom(claude: string, codex: string, warn: number, metric: number) {
  ACCENTS = [claude, codex];
  WARN_PCT = warn;
  QUOTA_METRIC = metric;
}

export const DEFAULT_ROLES = [2, 1, 1, 1, 1, 1]; // 0=不参与 1=进度条 2=源指示

/// 0-100 → 绿→红
export function gradeColor(pct: number): string {
  const hue = 120 * (1 - Math.min(pct, 100) / 100);
  return `hsl(${hue.toFixed(0)}, 72%, 46%)`;
}

/// Pro 模式:角色表 → 逐灯帧(与 firmware/common/usage_lights.c 一致)
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

/// 通用模式:整板一个颜色(与 src-tauri compute_via_look 一致)
export function computeViaLook(snap: Snapshot, mode: number, source: number, budget: number): ViaLook {
  const u = source === 0 ? snap.claude : snap.codex;
  const accent = ACCENTS[source] ?? ACCENTS[0];
  const pass: ViaLook = { color: null, blinkWarn: false, breathing: false };
  if (!u.valid) return pass;
  if (mode === 0) {
    const pct =
      QUOTA_METRIC === 1
        ? (u.weekly_pct ?? u.five_hour_pct)
        : QUOTA_METRIC === 2
          ? Math.max(u.five_hour_pct ?? -1, u.weekly_pct ?? -1) >= 0
            ? Math.max(u.five_hour_pct ?? 0, u.weekly_pct ?? 0)
            : null
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
    return { color: gradeColor(Math.min(100, (u.today_tokens * 100) / budget)), blinkWarn: false, breathing: false };
  }
  return u.active ? { color: accent, blinkWarn: false, breathing: true } : pass;
}

/// ViaLook → N 颗同色灯帧(通用模式的灯珠视图)
export function viaLookToFrame(look: ViaLook, n = 6): LedFrame {
  const base = { blinkAccent: false, accentIdx: [] as number[], blinkAll: false };
  if (look.color === null) {
    return { ...base, leds: Array(n).fill(OFF), breathing: false, passthrough: true };
  }
  return { ...base, leds: Array(n).fill(look.color), breathing: look.breathing, blinkAll: look.blinkWarn, passthrough: false };
}
