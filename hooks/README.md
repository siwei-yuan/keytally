# Activity hooks (optional, recommended)

Without hooks, KeyTally infers "AI is working" from session-log file timestamps — good, but it can lag ~10 s and can't tell "working" from "any session writing". With hooks, activity becomes **event-precise**.

## Claude Code

`claude-state-hook.sh` marks busy/idle per session. Add to `~/.claude/settings.json` (merge into your existing `hooks`, don't replace):

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"/path/to/keytally/hooks/claude-state-hook.sh\" busy", "async": true, "timeout": 10 }] }],
    "Stop":             [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"/path/to/keytally/hooks/claude-state-hook.sh\" idle", "async": true, "timeout": 10 }] }],
    "SessionEnd":       [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"/path/to/keytally/hooks/claude-state-hook.sh\" idle", "async": true, "timeout": 10 }] }]
  }
}
```

## Codex

Codex supports a single `notify` program. Point it at `codex-notify.sh` in `~/.codex/config.toml` (top-level, before any `[section]`):

```toml
notify = ["/path/to/keytally/hooks/codex-notify.sh"]
```

Already have a `notify` configured? Chain it — see `codex-notify-chain.sh` for an example that calls the original program first, then writes KeyTally's marker. (That file contains a machine-specific path; adapt it.)

## How it works

Hooks write tiny state files under `~/Library/Application Support/com.ysw.qmk-usage-lights/state/`. The app reads them; if none exist it falls back to timestamp watching. Stale files (>30 min) are ignored, so crashed sessions can't stick the light on.
