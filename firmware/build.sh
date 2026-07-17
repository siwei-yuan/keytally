#!/usr/bin/env bash
# 把本仓库的 keymap + 公共模块拷进 qmk_firmware 并编译(可选刷机)。
# 用法: ./build.sh [flash]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
QMK_HOME="${QMK_HOME:-$HOME/qmk_firmware}"
KB=gray_studio/think65v3
KM=usage_lights
KM_DIR="$QMK_HOME/keyboards/$KB/keymaps/$KM"

[ -d "$QMK_HOME" ] || { echo "qmk_firmware 不存在: $QMK_HOME"; exit 1; }

mkdir -p "$KM_DIR"
cp "$REPO"/firmware/think65v3/* "$KM_DIR/"
cp "$REPO"/firmware/common/usage_lights.{c,h} "$KM_DIR/"

if [ "${1:-}" = "flash" ]; then
    # DFU 模式:按 PCB 背面 reset 键进入
    qmk flash -kb "$KB" -km "$KM"
else
    qmk compile -kb "$KB" -km "$KM"
fi
