# Raw HID protocol

[中文版](protocol.zh-CN.md)

Version: 1

## Transport

- QMK Raw HID: usage page `0xFF60`, usage `0x61`, fixed **32-byte** reports.
- The firmware keeps VIA enabled: VIA shares the same Raw HID endpoint, and unknown
  command IDs are handed to `via_command_kb()`. All commands in this protocol use
  IDs in `0xC0–0xCF`, which VIA never uses.
- All fields are single bytes; no endianness concerns.

## Commands

| ID     | Direction      | Meaning                          |
|--------|----------------|----------------------------------|
| `0xC0` | app → keyboard | push usage data                  |
| `0xC1` | app → keyboard | set display state (mode/source)  |
| `0xC1` | keyboard → app | state report (same ID reused)    |
| `0xC2` | app → keyboard | query current state              |
| `0xC3` | app → keyboard | set LED role table               |
| `0xC4` | app → keyboard | set bar style                    |

## 0xC0 — usage data push (app → keyboard)

| Byte | Meaning |
|------|---------|
| 0    | `0xC0` |
| 1    | protocol version = `1` |
| 2    | validity flags: bit0 = Claude data valid, bit1 = Codex data valid |
| 3    | Claude 5-hour window usage % (0–100, `0xFF` = unknown) |
| 4    | Claude weekly limit usage % (same) |
| 5    | Claude today % (relative to daily budget, capped at 100; `0xFF` = unknown) |
| 6    | Claude activity: 0 = idle, 1 = working |
| 7    | Codex 5-hour window usage % |
| 8    | Codex weekly limit usage % |
| 9    | Codex today % |
| 10   | Codex activity |
| 11–31| reserved, zero |

Push cadence: every 15 s, plus an immediate push on activity changes. Each `0xC0`
resets the firmware's staleness timer.

**Timeout**: no `0xC0` for 60 s → the app is considered offline; the firmware clears
its data and restores the user's own lighting.

## 0xC1 — set state (app → keyboard)

| Byte | Meaning |
|------|---------|
| 0    | `0xC1` |
| 1    | mode: 0 = quota, 1 = today, 2 = activity, `0xFF` = unchanged |
| 2    | source: 0 = Claude, 1 = Codex, `0xFF` = unchanged |

The firmware applies the change and immediately sends a state report (below).

## 0xC1 — state report (keyboard → app)

Sent on keyboard-side key switches and in response to `0xC1`/`0xC2`:

| Byte | Meaning |
|------|---------|
| 0    | `0xC1` |
| 1    | current mode (0/1/2) |
| 2    | current source (0/1) |
| 3    | firmware protocol version = `1` |

## 0xC2 — query state (app → keyboard)

| Byte | Meaning |
|------|---------|
| 0    | `0xC2` |

Firmware replies with a state report. The app should send this right after
connecting/reconnecting to sync its UI.

## 0xC3 — set LED role table (app → keyboard)

| Byte | Meaning |
|------|---------|
| 0    | `0xC3` |
| 1    | start LED index |
| 2    | count |
| 3…   | roles, one byte per LED: 0 = none, 1 = bar, 2 = indicator |

Roles live in firmware RAM; the app re-pushes them from its per-board config on every
connect (no EEPROM writes). The compile-time table is the factory default.

## 0xC4 — set bar style (app → keyboard)

| Byte | Meaning |
|------|---------|
| 0    | `0xC4` |
| 1    | 0 = count (number of lit LEDs encodes the percentage), 1 = color (all bar LEDs lit; green→red encodes the percentage) |

## Firmware custom keycodes

| Keycode | Shown in VIA | Behavior |
|---------|--------------|----------|
| `QK_KB_0` | CUSTOM(0) | cycle mode (quota → today → activity → …) |
| `QK_KB_1` | CUSTOM(1) | toggle source (Claude ↔ Codex) |

State is kept in firmware RAM; power loss resets to mode = quota, source = Claude.
