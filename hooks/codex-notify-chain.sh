#!/bin/sh
# 链式 notify:保留 Codex Computer Use 原回调,再写我们的空闲标记
"/Users/ysw/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient" turn-ended "$@" 2>/dev/null || true
dir="$HOME/Library/Application Support/com.ysw.qmk-usage-lights/state/codex"
mkdir -p "$dir"; printf 'idle' > "$dir/notify"
exit 0
