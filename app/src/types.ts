// 全局共享类型(与 src-tauri 的序列化结构一一对应)

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

export interface KbState {
  mode: number;
  source: number;
  connected: boolean;
  device_name: string | null;
  backend: string | null; // "pro" | "via" | null
  lighting: string | null; // "rgblight" | "rgb_matrix" | "per-led" | null
  vid: number;
  pid: number;
  led_count: number; // Pro 固件回报;0 = 未知
  /// 通用模式探测到的灯光区能力表("rgblight" / "rgb_matrix",可并存)
  zones: string[];
  /// Pro 固件回报的逐键背光灯数(0 = 无)
  matrix_leds: number;
}

export interface AppConfig {
  claude_daily_budget: number;
  codex_daily_budget: number;
  warn_threshold: number;
  quota_metric: number;
  claude_color: string;
  codex_color: string;
  led_roles?: Record<string, number[]>;
  bar_style?: number;
  swap_rg?: Record<string, boolean>;
  /// 按板:通用模式下逐键背光不参与显示
  matrix_off?: Record<string, boolean>;
}

export interface FullState {
  snapshot: Snapshot;
  kb: KbState;
  config: AppConfig;
}

/// QMK 数据库条目(led-db.json)
export interface BoardData {
  n: string;
  rl: number;
  keys: [number, number, number, number][]; // x,y,w,h(键距 u)
  leds: [number, number, number][]; // rgb_matrix 灯坐标(0-224 × 0-64)+ flags
}

/// 社区标定(profiles.json)
export interface BoardProfile {
  name: string;
  note?: string;
  /// 标准配列名:"60" | "65" | "tkl87" | "96" | "104"(标定者确认的真实配列)
  layout?: string;
  /// face:"top"(正面,默认)| "side"(侧发光)| "bottom"(底光)。
  /// 目前 UI 仅绘制正面灯珠;side/bottom 会被如实计数但不绘制(见任务列表)。
  leds: { x: number; y: number; face?: "top" | "side" | "bottom" }[]; // 键距坐标
}

/// 通用模式的整板灯效意图(与 src-tauri compute_via_look 对应)
export interface ViaLook {
  color: string | null; // null = passthrough(显示用户自己的灯效)
  blinkWarn: boolean;
  breathing: boolean;
}

/// Pro 模式的逐灯帧
export interface LedFrame {
  leds: string[];
  breathing: boolean;
  blinkAccent: boolean; // 告警只闪指示灯
  accentIdx: number[];
  blinkAll: boolean; // 通用模式告警:整组闪
  passthrough: boolean;
}

export type GhostKey = [number, number, number, string?]; // x, y, w, 键帽标注(可选)
