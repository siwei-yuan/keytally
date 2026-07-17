#!/bin/sh
# usage: claude-state-hook.sh busy|idle ; stdin = Claude Code hook JSON
dir="$HOME/Library/Application Support/com.ysw.qmk-usage-lights/state/claude"
mkdir -p "$dir"
sid=$(python3 -c 'import json,sys;print(json.load(sys.stdin).get("session_id","default"))' 2>/dev/null || echo default)
printf '%s' "$1" > "$dir/${sid:-default}"
find "$dir" -type f -mtime +1 -delete 2>/dev/null
exit 0
