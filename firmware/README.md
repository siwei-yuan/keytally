# 固件(QMK keymap)

`common/` 是与键盘型号无关的公共逻辑。键盘型号确认后,在 QMK 仓库为其新建 keymap
(基于该键盘的 `via` keymap 复制),接入方式:

**1. `rules.mk`**(在 via keymap 的基础上追加):

```make
RAW_ENABLE = yes        # VIA 已隐含开启,写上无妨
SRC += usage_lights.c
VPATH += <本仓库>/firmware/common
```

**2. `usage_lights_config.h`**(keymap 目录下新建,按该键盘 LED 索引填写):

```c
#pragma once
#define UL_BAR1_LEDS {17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28} // 数字排
#define UL_BAR2_LEDS {33, 34, 35, 36, 37, 38, 39, 40, 41, 42}         // QWERTY 排
#define UL_ACCENT_LED 0                                                // Esc
```

LED 索引查键盘的 `info.json` → `rgb_matrix.layout`(顺序即索引),
或用 `qmk info -kb <kb> -m` 对照矩阵位置。

**3. `keymap.c`**:

```c
#include "usage_lights.h"

bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    return process_record_usage_lights(keycode, record);
}

bool rgb_matrix_indicators_advanced_user(uint8_t led_min, uint8_t led_max) {
    return ul_render(led_min, led_max);
}
```

把 `UL_KC_MODE` / `UL_KC_SRC`(VIA 里叫 USER00/USER01)绑到任意键位即可
在键盘上切模式/切数据源。

## 行为

- app 离线(拔线/退出)60 秒后固件完全不再干预灯效,键盘恢复原样。
- 模式/数据源状态存 RAM,掉电重置为 额度/Claude。
- VIA 改键照常可用;本协议命令区间 0xC0–0xCF 在 `via_command_kb()` 截获,
  不影响 VIA 协议本身。
