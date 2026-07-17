// QMK usage lights — 公共逻辑(rgblight 版,适配 6 灯氛围灯板如 Think6.5 V3)
// 协议见 docs/protocol.md。keymap 需提供 usage_lights_config.h:
//   #define UL_ACCENT_LED 0              // 数据源指示灯
//   #define UL_BAR_LEDS {1, 2, 3, 4, 5}  // 进度条灯(按物理顺序)
#pragma once

#include "quantum.h"

// ---- 协议常量 ----
#define UL_CMD_DATA 0xC0
#define UL_CMD_STATE 0xC1
#define UL_CMD_QUERY 0xC2
// 灯位角色表:data[1]=起始索引,data[2]=数量,data[3..]=角色数组(存 RAM,app 连接时重推)
#define UL_CMD_LED_ROLES 0xC3
// 进度条样式:data[1] 0=数量(亮灯数=百分比) 1=颜色(全亮,整体绿→红)
#define UL_CMD_BAR_STYLE 0xC4
#define UL_PROTOCOL_VERSION 1
#define UL_UNKNOWN 0xFF
#define UL_TIMEOUT_MS 60000
// 周限额超过该值时,额度模式下指示灯闪红警告
#define UL_WEEKLY_WARN_PCT 80

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

// 灯位角色
enum ul_role { UL_ROLE_NONE = 0, UL_ROLE_BAR = 1, UL_ROLE_ACCENT = 2 };

extern ul_state_t ul_state;

// keymap 集成点:
// - process_record_user() 里调用 process_record_usage_lights()
// - housekeeping_task_user() 里调用 ul_task()
// - VIA 固件自动经 via_command_kb() 接管;非 VIA 用 raw_hid_receive()
bool process_record_usage_lights(uint16_t keycode, keyrecord_t *record);
void ul_task(void);
void ul_handle_packet(uint8_t *data, uint8_t length);

// 自定义键码(VIA 里用 Any 键绑 QK_KB_0 / QK_KB_1)
#define UL_KC_MODE QK_KB_0
#define UL_KC_SRC QK_KB_1
