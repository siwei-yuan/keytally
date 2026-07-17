#include "usage_lights.h"
#include "usage_lights_config.h"
#include "raw_hid.h"
#include "rgblight.h"

ul_state_t ul_state = {
    .mode   = UL_MODE_QUOTA,
    .source = UL_SRC_CLAUDE,
};

// 出厂默认灯位(可被 0xC3 运行时覆盖)
static const uint8_t default_bar[] = UL_BAR_LEDS;

// 运行时角色表
static uint8_t led_roles[RGBLIGHT_LED_COUNT];
static uint8_t bar_style = 0; // 0=数量 1=颜色
static bool    roles_init = false;

static void roles_load_default(void) {
    for (uint8_t i = 0; i < RGBLIGHT_LED_COUNT; i++) led_roles[i] = UL_ROLE_NONE;
    for (uint8_t i = 0; i < ARRAY_SIZE(default_bar); i++) {
        if (default_bar[i] < RGBLIGHT_LED_COUNT) led_roles[default_bar[i]] = UL_ROLE_BAR;
    }
    if (UL_ACCENT_LED < RGBLIGHT_LED_COUNT) led_roles[UL_ACCENT_LED] = UL_ROLE_ACCENT;
    roles_init = true;
}

// 收集当前角色为某值的灯,按索引升序;返回数量
static uint8_t roles_collect(uint8_t role, uint8_t *out, uint8_t max) {
    if (!roles_init) roles_load_default();
    uint8_t n = 0;
    for (uint8_t i = 0; i < RGBLIGHT_LED_COUNT && n < max; i++) {
        if (led_roles[i] == role) out[n++] = i;
    }
    return n;
}

// 是否正在接管灯效(接管期间切到 static 模式;释放时从 EEPROM 恢复用户设置)
static bool override_active = false;

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
        case UL_CMD_BAR_STYLE:
            bar_style = data[1] == 1 ? 1 : 0;
            break;
        case UL_CMD_LED_ROLES: {
            if (!roles_init) roles_load_default();
            uint8_t off = data[1], cnt = data[2];
            for (uint8_t i = 0; i < cnt && off + i < RGBLIGHT_LED_COUNT && 3 + i < length; i++) {
                led_roles[off + i] = data[3 + i];
            }
            break;
        }
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

static void take_over(void) {
    if (!override_active) {
        override_active = true;
        rgblight_mode_noeeprom(RGBLIGHT_MODE_STATIC_LIGHT);
    }
}

static void release(void) {
    if (override_active) {
        override_active = false;
        rgblight_reload_from_eeprom(); // 恢复用户自己的灯效设置
    }
}

// 0-100 → 绿(hue 85)→红(hue 0)
static rgb_t grade_color(uint8_t pct, uint8_t val) {
    hsv_t hsv = {.h = (uint8_t)((uint16_t)85 * (100 - pct) / 100), .s = 255, .v = val};
    return hsv_to_rgb(hsv);
}

static void set_led(uint8_t idx, uint8_t r, uint8_t g, uint8_t b) {
    rgblight_setrgb_at(r, g, b, idx);
}

// pct 灌进 n 段进度条;gradient=true 用绿→红,否则用 color 填充
static void render_bar(const uint8_t *leds, uint8_t n, uint8_t pct, bool gradient, const uint8_t *color, uint8_t val) {
    if (pct == UL_UNKNOWN || n == 0) {
        for (uint8_t i = 0; i < n; i++) set_led(leds[i], 0, 0, 0);
        return;
    }
    if (pct > 100) pct = 100;
    rgb_t gc = grade_color(pct, val);
    if (bar_style == 1) { // 颜色式:全亮,整体颜色编码百分比
        for (uint8_t i = 0; i < n; i++) set_led(leds[i], gc.r, gc.g, gc.b);
        return;
    }
    uint8_t lit = (uint8_t)(((uint16_t)pct * n + 50) / 100);
    if (pct > 0 && lit == 0) lit = 1; // 有消耗就至少亮一格
    for (uint8_t i = 0; i < n; i++) {
        if (i < lit) {
            if (gradient) {
                set_led(leds[i], gc.r, gc.g, gc.b);
            } else {
                set_led(leds[i], (uint16_t)color[0] * val / 255, (uint16_t)color[1] * val / 255,
                        (uint16_t)color[2] * val / 255);
            }
        } else {
            set_led(leds[i], 0, 0, 0);
        }
    }
}

// 2.2s 三角波呼吸系数 (115-255)
static uint8_t breathe_scale(void) {
    uint16_t t     = timer_read32() % 2200;
    uint16_t phase = t < 1100 ? t : 2200 - t;
    return 115 + (uint8_t)((uint32_t)phase * 140 / 1100);
}

void ul_task(void) {
    static uint32_t last_render = 0;
    if (timer_elapsed32(last_render) < 50) return; // ~20fps 足够
    last_render = timer_read32();

    bool fresh = ul_state.last_packet_time != 0 && timer_elapsed32(ul_state.last_packet_time) < UL_TIMEOUT_MS;
    if (!fresh) {
        release(); // app 离线:恢复用户灯效
        return;
    }

    const ul_source_data_t *d      = &ul_state.data[ul_state.source];
    const uint8_t          *accent = accent_rgb[ul_state.source];
    uint8_t                 val    = rgblight_get_val();

    uint8_t bar[RGBLIGHT_LED_COUNT], accents[RGBLIGHT_LED_COUNT];
    uint8_t bar_n    = roles_collect(UL_ROLE_BAR, bar, RGBLIGHT_LED_COUNT);
    uint8_t accent_n = roles_collect(UL_ROLE_ACCENT, accents, RGBLIGHT_LED_COUNT);

    if (!d->valid) {
        take_over();
        for (uint8_t i = 0; i < accent_n; i++) set_led(accents[i], 30, 30, 30);
        for (uint8_t i = 0; i < bar_n; i++) set_led(bar[i], 0, 0, 0);
        return;
    }

    uint8_t ar = (uint16_t)accent[0] * val / 255;
    uint8_t ag = (uint16_t)accent[1] * val / 255;
    uint8_t ab = (uint16_t)accent[2] * val / 255;

    switch (ul_state.mode) {
        case UL_MODE_QUOTA:
            take_over();
            render_bar(bar, bar_n, d->five_hour_pct, true, NULL, val);
            // 周限额告警:指示灯在源色和红色之间 1Hz 交替
            for (uint8_t i = 0; i < accent_n; i++) {
                if (d->weekly_pct != UL_UNKNOWN && d->weekly_pct >= UL_WEEKLY_WARN_PCT && (timer_read32() % 1000) < 500) {
                    set_led(accents[i], val, 0, 0);
                } else {
                    set_led(accents[i], ar, ag, ab);
                }
            }
            break;
        case UL_MODE_TODAY:
            take_over();
            render_bar(bar, bar_n, d->today_pct, false, accent, val);
            for (uint8_t i = 0; i < accent_n; i++) set_led(accents[i], ar, ag, ab);
            break;
        case UL_MODE_ACTIVITY:
            if (d->active) {
                take_over();
                uint8_t s = breathe_scale();
                for (uint8_t i = 0; i < RGBLIGHT_LED_COUNT; i++) {
                    set_led(i, (uint16_t)ar * s / 255, (uint16_t)ag * s / 255, (uint16_t)ab * s / 255);
                }
            } else {
                release(); // 空闲:完全不干预
            }
            break;
    }
}
