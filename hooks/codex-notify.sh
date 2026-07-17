#!/bin/sh
# codex notify 回调:turn 完成 = 空闲标记
dir="$HOME/Library/Application Support/com.ysw.qmk-usage-lights/state/codex"
mkdir -p "$dir"
printf 'idle' > "$dir/notify"
exit 0
