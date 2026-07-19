// Percent Skog Reboot:10 颗 WS2812(链上 0-4 = 箭头区上方可见灯条,5-9 = 底面 logo 灯)
// 链序依据:原厂 keymap 的 caps lock 指示层段为 {0, 5},点亮的正是明面灯条。
// LED 0 = 数据源指示,LED 1-4 = 进度条(不对就改这里,或在 app 里逐灯改角色)
#pragma once

// 2023 版 QMK fork 中灯数宏还叫 RGBLED_NUM(上游后来改名 RGBLIGHT_LED_COUNT)
#ifndef RGBLIGHT_LED_COUNT
#    define RGBLIGHT_LED_COUNT RGBLED_NUM
#endif

// 同理,颜色类型当年叫 RGB/HSV(上游后来小写化为 rgb_t/hsv_t)
typedef RGB rgb_t;
typedef HSV hsv_t;

#define UL_ACCENT_LED 0
#define UL_BAR_LEDS {1, 2, 3, 4}
