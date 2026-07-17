# 固件(QMK keymap)

目标键盘:**GrayStudio Think6.5 V3**(`gray_studio/think65v3`,STM32F072,
6 颗 WS2812 氛围灯走 `rgblight`,键帽无 RGB)。

```
common/      与型号无关的公共逻辑(协议、状态机、rgblight 渲染)
think65v3/   keymap 源码(VIA + usage lights),build.sh 会拷进 qmk_firmware
build.sh     编译 / 刷机脚本
```

## 构建与刷机

```sh
./build.sh          # 编译 → qmk_firmware/.build/gray_studio_think65v3_usage_lights.bin
./build.sh flash    # 编译并刷机(需先按 PCB 背面 reset 键进 DFU 模式)
```

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

## 社区适配新键盘(开源后)

1. 复制 `think65v3/` 为你的板子目录,按板改 `usage_lights_config.h`(LED 索引)
   和 keymap;`./build.sh` 编译出 .bin。
2. app 侧在 `app/src-tauri/src/flash.rs` 的注册表加一行 VID/PID → bin 路径,
   `app/src/main.ts` 的 `PRO_BOARDS` 加同一 VID/PID。
3. 插上键盘 → 设置里「升级到 Pro」即可一键刷入(自动备份/恢复 VIA 键位,
   bootloader 走 VIA 0x0B 软件跳转,无需拆壳)。
