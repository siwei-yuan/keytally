# 固件(QMK keymap)

[English](README.md)

参考板(均已接入 app 一键刷机):

| 键盘 | 主控 | 源码树 | 灯 | 刷机工具 |
|---|---|---|---|---|
| GrayStudio Think6.5 V3(`gray_studio/think65v3`) | STM32F072 | QMK 主线 | 6 颗 WS2812 徽章灯 | `dfu-util` |
| Percent Skog Reboot(`bioi/skog_reboot`) | AVR at90usb646/1286(rev A/B) | [scottywei fork](https://github.com/scottywei/qmk_firmware/tree/update-and-add-bioi-keyboards)(BLE 双模) | 10 颗 WS2812(5 灯条 + 5 底部 logo) | `dfu-programmer` |

```
common/           与型号无关的公共逻辑(协议、状态机、rgblight 渲染)
think65v3/        Think6.5 V3 Pro keymap(VIA + usage lights)
think65v3-plain/  纯净 VIA keymap(Think65「还原原厂」的回退目标)
skog_reboot/      Skog Reboot Pro keymap(VIA + usage lights,BLE 双模保留)
build.sh          编译 / 刷机脚本(找得到源码树的板子都会编)
```

## 构建与刷机

```sh
./build.sh          # 编译 → qmk_firmware/.build/gray_studio_think65v3_usage_lights.bin
./build.sh flash    # 编译并刷机(需先按 PCB 背面 reset 键进 DFU 模式)
```

### Skog Reboot 附加步骤

Skog Reboot 只能在 scottywei 的 QMK fork 里编译(BLE 双模依赖自定义
`main.c`/`ble.c`/`usart.c`),`build.sh` 会在 `~/qmk_firmware-bioi` 找这棵树,
找不到就跳过:

```sh
brew install osx-cross/avr/avr-gcc@8 avr-binutils dfu-programmer
git clone --depth 1 -b update-and-add-bioi-keyboards \
    https://github.com/scottywei/qmk_firmware ~/qmk_firmware-bioi
cd ~/qmk_firmware-bioi && git submodule update --init --depth 1 lib/lufa lib/printf
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt qmk
```

`build.sh` 会产出 rev A/B 两个 hex(`bioi_skog_reboot_rev_{a,b}_usage_lights.hex`);
刷机时 app 用 `dfu-programmer <mcu> get` 探测 DFU 中的芯片自动选择。keymap 里有
两处 Skog 专属修正:原厂树配置了 `WS2812_BYTE_ORDER_RGB`,在实为 GRB 的灯珠上
红绿互换(实机确认),我们的 `config.h` 撤销该定义回到 GRB 默认;2023 版 fork
早于 `RGBLIGHT_LED_COUNT`/`rgb_t` 改名,`usage_lights_config.h` 带了兼容 shim。
「还原原厂」刷回官方 v1.2 发布固件
([percent-skog-reboot Releases](https://github.com/scottywei/percent-skog-reboot/releases))。

依赖(一次性):

```sh
brew tap osx-cross/arm && brew tap osx-cross/avr
brew trust qmk/qmk && brew trust osx-cross/arm && brew trust osx-cross/avr   # 新版 brew 需要
brew install qmk/qmk/qmk
git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/qmk/qmk_firmware ~/qmk_firmware
qmk config user.qmk_home=$HOME/qmk_firmware
```

## 灯效方案(6 灯)

- **LED 0 指示灯**:数据源颜色(Claude 珊瑚橙 / Codex 青);额度模式下周限额 ≥80%
  时红色 1Hz 闪烁告警;数据源未安装时暗灰。
- **LED 1–5 进度条**:
  - 额度模式:5h 窗口用量,绿→红渐变;有消耗至少亮一格。
  - 今日消耗模式:相对日预算的百分比,源色填充(与额度模式视觉区分)。
- **活动模式**:干活时 6 灯整体源色呼吸(2.2s);空闲时**完全不接管**,
  显示用户自己的 rgblight 灯效。
- app 离线(拔线/退出)60 秒后从 EEPROM 恢复用户灯效设置,键盘恢复原样。
- LED 物理顺序若与预期不符,改 `think65v3/usage_lights_config.h`。

## 键盘上切换

Fn 层已绑:`Fn+,` 切模式,`Fn+.` 切数据源(即 `UL_KC_MODE`/`UL_KC_SRC`,
VIA 里用 Any 键填 `QK_KB_0`/`QK_KB_1` 可重绑)。

## 行为细节

- 模式/数据源状态存 RAM,掉电重置为 额度/Claude;切换后固件回发状态包,app UI 同步。
- VIA 改键照常可用;本协议命令区间 0xC0–0xCF 在 `via_command_kb()` 截获。
- 上游 kb 级代码的 Caps Lock 白灯层(rgblight layer)优先级更高,开大写时 6 灯变白,
  属预期行为。

## 社区适配新键盘

两级范式,按投入选择:

### 第一级 —— 只标定,不刷机(约 2 分钟)

告诉 app 你板子上灯的物理位置。在 `app/src/profiles.json` 里按 `vid:pid` 加一条:

```jsonc
"8101:5352": {
  "name": "Percent Skog Reboot",
  "layout": "tkl87",                    // 60 | 65 | tkl87 | 96 | 104
  "leds": [
    { "x": 15.4, "y": 4.0 },            // 键距坐标,face 缺省为 "top"
    { "x": 8.0, "y": 6.2, "face": "bottom" }  // 侧/底灯:如实计数,不绘制
  ]
}
```

坐标单位是键距(1u = 一个键)。请对照实机标定——UI 会打出 `已标定 · JSON`
数据来源标签。灯请按**链上顺序、`face:"top"` 在前**排列,这样以后若有人做
Pro 固件,UI 灯珠索引与固件灯序天然对齐。只 PR 这一个文件即可。

### 第二级 —— Pro 固件(逐灯控制、键盘侧切换)

1. 以 `think65v3/`(主线板)或 `skog_reboot/`(厂商 fork 板)为模板复制一份,
   按板改 `usage_lights_config.h`(默认灯位角色)和 keymap;把板子加进 `build.sh`。
2. app 侧:`app/src-tauri/src/flash.rs` 注册 VID/PID → `FlashJob`
   (dfu-util 板用 `Stm32Bin`;dfu-programmer 板用 `AvrHex`,每个硬件 rev
   一个芯片候选),`app/src/main.ts` 的 `PRO_BOARDS` 加同一 VID/PID。
3. 插上键盘 → 设置里「刷入 Pro 固件」一键完成(自动备份/恢复 VIA 键位,
   bootloader 走 VIA 0x0B 软件跳转,无需拆壳;厂商固件不响应时回退临时 Fn+Esc)。

若板子已有第一级 profile,Pro UI 会直接复用:逐灯点选/框选改角色就发生在
标定好的配列图上。
