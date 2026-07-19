#!/usr/bin/env bash
# 把本仓库的 keymap + 公共模块拷进 qmk_firmware 并编译(可选刷机)。
# 用法: ./build.sh [flash]
set -euo pipefail

# brew 的 ARM 交叉工具链是 keg-only,不在默认 PATH
export PATH="/opt/homebrew/opt/arm-none-eabi-gcc@8/bin:/opt/homebrew/opt/arm-none-eabi-binutils/bin:/opt/homebrew/bin:$PATH"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
QMK_HOME="${QMK_HOME:-$HOME/qmk_firmware}"
KB=gray_studio/think65v3
KM=usage_lights
KM_DIR="$QMK_HOME/keyboards/$KB/keymaps/$KM"

[ -d "$QMK_HOME" ] || { echo "qmk_firmware 不存在: $QMK_HOME"; exit 1; }

mkdir -p "$KM_DIR"
cp "$REPO"/firmware/think65v3/* "$KM_DIR/"
cp "$REPO"/firmware/common/usage_lights.{c,h} "$KM_DIR/"

# 纯净 VIA 固件(「还原原厂」的回退目标)
PLAIN_DIR="$QMK_HOME/keyboards/$KB/keymaps/via_plain"
mkdir -p "$PLAIN_DIR"
cp "$REPO"/firmware/think65v3-plain/* "$PLAIN_DIR/"

if [ "${1:-}" = "flash" ]; then
    # DFU 模式:按 PCB 背面 reset 键进入
    qmk flash -kb "$KB" -km "$KM"
else
    qmk compile -kb "$KB" -km "$KM"
    qmk compile -kb "$KB" -km via_plain
fi

# ---- Percent Skog Reboot(AVR,BLE 双模,只能在 scottywei fork 树里编译)----
# fork: github.com/scottywei/qmk_firmware @ update-and-add-bioi-keyboards
QMK_BIOI="${QMK_BIOI:-$HOME/qmk_firmware-bioi}"
if [ -d "$QMK_BIOI" ]; then
    export PATH="/opt/homebrew/opt/avr-gcc@8/bin:$PATH"
    SKOG_KM_DIR="$QMK_BIOI/keyboards/bioi/skog_reboot/keymaps/$KM"
    mkdir -p "$SKOG_KM_DIR"
    cp "$REPO"/firmware/skog_reboot/* "$SKOG_KM_DIR/"
    cp "$REPO"/firmware/common/usage_lights.{c,h} "$SKOG_KM_DIR/"
    # rev_a = at90usb646 / rev_b = at90usb1286(刷机时由 dfu-programmer 探测芯片选用)
    # 老树的增量构建偶发 LTO "-mmcu more than once",清目标缓存保证确定性
    rm -rf "$QMK_BIOI"/.build/obj_bioi_skog_reboot_rev_{a,b}_"$KM"
    make -C "$QMK_BIOI" "bioi/skog_reboot/rev_a:$KM"
    make -C "$QMK_BIOI" "bioi/skog_reboot/rev_b:$KM"
else
    echo "跳过 Skog Reboot:未找到 $QMK_BIOI(git clone -b update-and-add-bioi-keyboards https://github.com/scottywei/qmk_firmware \"\$HOME/qmk_firmware-bioi\")"
fi
