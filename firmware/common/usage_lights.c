#include "usage_lights.h"
#include "usage_lights_config.h"
#include "raw_hid.h"

ul_state_t ul_state = {
    .mode   = UL_MODE_QUOTA,
    .source = UL_SRC_CLAUDE,
};

static const uint8_t bar1_leds[] = UL_BAR1_LEDS;
static const uint8_t bar2_leds[] = UL_BAR2_LEDS;
#define BAR1_LEN ARRAY_SIZE(bar1_leds)
#define BAR2_LEN ARRAY_SIZE(bar2_leds)

// 数据源指示色:Claude 珊瑚橙 / Codex 青(与 app 预览一致)
static const uint8_t accent_rgb[UL_SRC_COUNT][3] = {
    {217, 119, 87},
    {16, 163, 127},
};

// ---- HID ----

static void ul_send_state_report(void) {
    uint8_t buf[32] = {0};
    buf[0]          = UL_CMD_STATE;
    buf[1]          = ul_state.mode;
    buf[2]          = ul_state.source;
    buf[3]          = UL_PROTOCOL_VERSION;
    raw_hid_send(buf, sizeof(buf));
}

void ul_handle_packet(uint8_t *data, uint8_t length) {
    if (length < 3) return;
    switch (data[0]) {
        case UL_CMD_DATA: {
            if (data[1] != UL_PROTOCOL_VERSION) return;
            ul_state.data[UL_SRC_CLAUDE] = (ul_source_data_t){
                .valid         = data[2] & 1,
                .five_hour_pct = data[3],
                .weekly_pct    = data[4],
                .today_pct     = data[5],
                .active        = data[6] != 0,
            };
            ul_state.data[UL_SRC_CODEX] = (ul_source_data_t){
                .valid         = (data[2] >> 1) & 1,
                .five_hour_pct = data[7],
                .weekly_pct    = data[8],
                .today_pct     = data[9],
                .active        = data[10] != 0,
            };
            uint32_t now              = timer_read32();
            ul_state.last_packet_time = now ? now : 1;
            break;
        }
        case UL_CMD_STATE:
            if (data[1] != UL_UNKNOWN && data[1] < UL_MODE_COUNT) ul_state.mode = data[1];
            if (data[2] != UL_UNKNOWN && data[2] < UL_SRC_COUNT) ul_state.source = data[2];
            ul_send_state_report();
            break;
        case UL_CMD_QUERY:
            ul_send_state_report();
            break;
    }
}

#ifdef VIA_ENABLE
// VIA 走同一个 Raw HID 端点;先截我们的命令区间,其余交回 VIA
bool via_command_kb(uint8_t *data, uint8_t length) {
    if (data[0] >= 0xC0 && data[0] <= 0xCF) {
        ul_handle_packet(data, length);
        return true;
    }
    return false;
}
#else
void raw_hid_receive(uint8_t *data, uint8_t length) {
    ul_handle_packet(data, length);
}
#endif

// ---- 按键 ----

bool process_record_usage_lights(uint16_t keycode, keyrecord_t *record) {
    if (!record->event.pressed) return true;
    switch (keycode) {
        case UL_KC_MODE:
            ul_state.mode = (ul_state.mode + 1) % UL_MODE_COUNT;
            ul_send_state_report();
            return false;
        case UL_KC_SRC:
            ul_state.source = (ul_state.source + 1) % UL_SRC_COUNT;
            ul_send_state_report();
            return false;
    }
    return true;
}

// ---- 渲染 ----

static bool ul_data_fresh(void) {
    return ul_state.last_packet_time != 0 && timer_elapsed32(ul_state.last_packet_time) < UL_TIMEOUT_MS;
}

// 0-100 → 绿(hue 85)→红(hue 0),与 app 预览的 HSL 渐变对应
static void bar_color(uint8_t pct, uint8_t *r, uint8_t *g, uint8_t *b) {
    hsv_t hsv = {.h = (uint8_t)((uint16_t)85 * (100 - pct) / 100), .s = 255, .v = rgb_matrix_get_val()};
    rgb_t rgb = hsv_to_rgb(hsv);
    *r        = rgb.r;
    *g        = rgb.g;
    *b        = rgb.b;
}

static void render_bar(const uint8_t *leds, uint8_t len, uint8_t pct, uint8_t led_min, uint8_t led_max) {
    if (pct == UL_UNKNOWN || len == 0) return;
    if (pct > 100) pct = 100;
    uint8_t lit = (uint8_t)(((uint16_t)pct * len + 50) / 100);
    uint8_t r, g, b;
    bar_color(pct, &r, &g, &b);
    for (uint8_t i = 0; i < len; i++) {
        uint8_t led = leds[i];
        if (led < led_min || led >= led_max) continue;
        if (i < lit) {
            rgb_matrix_set_color(led, r, g, b);
        } else {
            rgb_matrix_set_color(led, 0, 0, 0);
        }
    }
}

bool ul_render(uint8_t led_min, uint8_t led_max) {
    if (!ul_data_fresh()) return false; // app 离线:完全不干预,恢复正常灯效

    const ul_source_data_t *d      = &ul_state.data[ul_state.source];
    const uint8_t          *accent = accent_rgb[ul_state.source];
    uint8_t                 val    = rgb_matrix_get_val();

    if (!d->valid) {
        if (UL_ACCENT_LED >= led_min && UL_ACCENT_LED < led_max) {
            rgb_matrix_set_color(UL_ACCENT_LED, 40, 40, 40);
        }
        return false;
    }

    switch (ul_state.mode) {
        case UL_MODE_QUOTA:
            render_bar(bar1_leds, BAR1_LEN, d->five_hour_pct, led_min, led_max);
            render_bar(bar2_leds, BAR2_LEN, d->weekly_pct, led_min, led_max);
            break;
        case UL_MODE_TODAY:
            render_bar(bar1_leds, BAR1_LEN, d->today_pct, led_min, led_max);
            break;
        case UL_MODE_ACTIVITY:
            if (d->active) {
                // 整板呼吸:2.2s 三角波,亮度跟随用户的 RGB 亮度设置
                uint16_t t     = timer_read32() % 2200;
                uint16_t phase = t < 1100 ? t : 2200 - t;
                uint8_t  scale = 115 + (uint8_t)((uint32_t)phase * 140 / 1100); // 45%-100%
                for (uint8_t led = led_min; led < led_max; led++) {
                    rgb_matrix_set_color(led, (uint16_t)accent[0] * val / 255 * scale / 255,
                                         (uint16_t)accent[1] * val / 255 * scale / 255,
                                         (uint16_t)accent[2] * val / 255 * scale / 255);
                }
            }
            break;
    }

    if (UL_ACCENT_LED >= led_min && UL_ACCENT_LED < led_max) {
        rgb_matrix_set_color(UL_ACCENT_LED, (uint16_t)accent[0] * val / 255, (uint16_t)accent[1] * val / 255,
                             (uint16_t)accent[2] * val / 255);
    }
    return false;
}
