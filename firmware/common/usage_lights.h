// QMK usage lights — 公共逻辑(与键盘型号无关)
// 协议见 docs/protocol.md。keymap 需提供 usage_lights_config.h 定义 LED 索引:
//   #define UL_BAR1_LEDS {17, 18, ...}   // 主进度条(数字排)
//   #define UL_BAR2_LEDS {33, 34, ...}   // 次进度条(周限额;可为空 {})
//   #define UL_ACCENT_LED 0              // 数据源指示灯(Esc)
#pragma once

#include "quantum.h"

// ---- 协议常量 ----
#define UL_CMD_DATA 0xC0
#define UL_CMD_STATE 0xC1
#define UL_CMD_QUERY 0xC2
#define UL_PROTOCOL_VERSION 1
#define UL_UNKNOWN 0xFF
#define UL_TIMEOUT_MS 60000

// ---- 显示状态 ----
enum ul_mode { UL_MODE_QUOTA = 0, UL_MODE_TODAY = 1, UL_MODE_ACTIVITY = 2, UL_MODE_COUNT };
enum ul_source { UL_SRC_CLAUDE = 0, UL_SRC_CODEX = 1, UL_SRC_COUNT };

typedef struct {
    uint8_t five_hour_pct; // 0-100,UL_UNKNOWN = 未知
    uint8_t weekly_pct;
    uint8_t today_pct;
    bool    active;
    bool    valid;
} ul_source_data_t;

typedef struct {
    uint8_t          mode;
    uint8_t          source;
    ul_source_data_t data[UL_SRC_COUNT];
    uint32_t         last_packet_time; // timer_read32() 时刻;0 = 从未收到
} ul_state_t;

extern ul_state_t ul_state;

// keymap 集成点:
// - process_record_user() 里调用 process_record_usage_lights()
// - rgb_matrix_indicators_advanced_user() 里调用 ul_render()
// - VIA 固件自动经 via_command_kb() 接管;非 VIA 用 raw_hid_receive()
bool process_record_usage_lights(uint16_t keycode, keyrecord_t *record);
bool ul_render(uint8_t led_min, uint8_t led_max);
void ul_handle_packet(uint8_t *data, uint8_t length);

// 自定义键码(VIA 里显示为 USER00/USER01)
#define UL_KC_MODE QK_KB_0
#define UL_KC_SRC QK_KB_1
