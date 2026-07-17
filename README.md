<div align="center">

# ⌨️ QMK Usage Lights

**Turn your keyboard's LEDs into a real-time AI usage meter.**

Claude Code & Codex quota, daily burn, and live activity — rendered on any VIA/QMK keyboard's lights, with a NASApunk-styled menu bar app for macOS.

[中文文档](README.zh-CN.md) · [Firmware guide](firmware/README.md) · [HID protocol](docs/protocol.md)

![Tauri](https://img.shields.io/badge/Tauri%202-app-24C8DB?logo=tauri&logoColor=white)
![QMK](https://img.shields.io/badge/QMK-firmware-333)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-000?logo=apple)
![License](https://img.shields.io/badge/license-MIT%20%2B%20GPL--2.0-blue)

<img src="docs/assets/ui-pro.png" alt="QMK Usage Lights UI" width="820"/>

</div>

## Why

You're deep in a Claude Code session and the 5-hour window runs out with zero warning. Your keyboard has RGB sitting right there doing rainbow swirls. Connect the two: **glance at your keys, know your quota.**

- 🟢→🔴 **Quota mode** — subscription usage (5-hour window / weekly limit) as a green-to-red meter
- 📊 **Daily burn mode** — today's token spend vs. your configured budget
- 🫁 **Activity mode** — LEDs breathe while the AI is working; your own lighting returns when idle
- 🔀 One keypress (or click) switches between **Claude Code** and **Codex**

## How it works

```
┌─ macOS menu bar app (Tauri 2) ─────────┐        ┌─ your keyboard ────────────┐
│ collectors:                            │        │                            │
│  · Claude OAuth usage API (Keychain)   │  Raw   │  Universal: VIA lighting   │
│  · ~/.claude + ~/.codex session logs   │  HID   │  protocol, whole-board     │
│  · Claude Code hooks + Codex notify    │ ─────► │  color (zero flashing)     │
│    (event-precise activity)            │        │                            │
│ UI: live per-LED preview, LED role     │ ◄───── │  Pro: custom QMK firmware, │
│  editor, budgets, colors, thresholds   │        │  per-LED bar + indicator   │
└────────────────────────────────────────┘        └────────────────────────────┘
```

Two tiers, auto-detected on plug-in:

| | 🌍 Universal mode | 🚀 Pro mode |
|---|---|---|
| Works on | **any VIA keyboard with lights** (VIA protocol v2/v3, rgblight or rgb_matrix) | boards with a community firmware build ([adapt yours in ~5 min](firmware/README.md)) |
| Flashing required | **none** — plug and play | one click in the app (auto keymap/macro backup & restore) |
| Light rendering | whole-board color = usage | per-LED: progress bar + source indicator |
| Switch mode/source from keyboard | — | ✅ two bindable keycodes, syncs back to the app |
| App offline | reboot keyboard to restore lighting | firmware auto-restores your lighting after 60 s |
| LED layout | fixed | **click / drag-select LEDs in the app to assign roles** |

Safety first: all universal-mode writes are volatile (never saved to EEPROM) — unplug/replug and your keyboard is exactly as it was. Pro flashing backs up your VIA keymap + macros and writes them back automatically, and attempts a factory-firmware readout so you can restore later.

## Install

Prebuilt releases are planned; for now, build from source (macOS, Apple Silicon):

```sh
# prerequisites: Rust (rustup.rs) and Node 20+
git clone https://github.com/siwei-yuan/qmk-usage-lights
cd qmk-usage-lights/app
npm install
npm run tauri build        # or: npm run tauri dev
```

The app lives in your menu bar. Optional extras:

- **Pro firmware builds** need the QMK toolchain: `brew install qmk/qmk/qmk`, then `./firmware/build.sh`
- **Event-precise activity detection** hooks into Claude Code (`~/.claude/settings.json` hooks) and Codex (`notify` in `~/.codex/config.toml`) — see [hooks/](hooks/). Without them the app falls back to watching session-log timestamps.

## Quick start

1. **Plug in** your VIA keyboard (wired USB — Raw HID doesn't ride Bluetooth).
2. The app auto-detects it. Status bar shows the tier: `VIA 通用` (universal) or `Pro 固件` (per-LED).
3. Pick a **data source** (Claude / Codex) and a **metric** (quota / daily burn / activity).
4. Open **设置 (Settings)** to set your daily token budget, weekly-limit warning threshold, and per-source colors.

The keyboard preview in the app is a live twin of your physical LEDs — what you see is what glows.

### Going Pro

Settings → **PRO 模式**: one click flashes the usage-lights QMK firmware (**this rewrites your keyboard's firmware**, not this app). The flow:

1. Backs up your VIA keymap + macros over Raw HID
2. Enters the bootloader (software jump; if your vendor firmware blocks it, the app temporarily maps `Fn+Esc` as the bootloader key and prompts you)
3. Reads out your factory firmware for later restore (when the MCU isn't read-protected)
4. Flashes, waits for reconnect, writes your keymap back

**Restore** is one click too: factory dump if we have it, otherwise a clean VIA-only build that behaves exactly like stock.

### LED role editor (Pro)

Click a LED — or drag a box around several — in the app's keyboard view. A panel pops up underneath:

- **Progress bar** — these LEDs fill up with usage (count style: N lit = percentage, or color style: all lit, green→red encodes the percentage)
- **Source indicator** — shows Claude/Codex color; blinks red when the weekly limit crosses your threshold
- **Not involved** — keeps your own lighting

Roles persist per keyboard and re-apply on every connect.

## Supported keyboards

- **Universal mode**: any VIA-enabled QMK keyboard with lights. LED-zone previews are generated from the QMK database (2,677 boards, by USB VID/PID).
- **Pro mode**:

| Board | Status |
|---|---|
| GrayStudio Think6.5 V3 | ✅ reference implementation |
| *your board here* | [3-step adaptation guide](firmware/README.md) — a LED config header + one compile |

## FAQ

**Is universal mode safe?** Yes — it speaks the same VIA protocol your VIA app uses, saves your current lighting before taking over, restores it on quit, and never writes EEPROM. A reboot always returns the keyboard to stock behavior.

**Will Pro flashing lose my keymap?** No. Keymap and macros are dumped before flashing and restored after. VIA keeps working on the Pro firmware (our protocol rides command IDs VIA ignores).

**Bluetooth?** No — Raw HID requires a wired USB connection.

**Windows/Linux?** The collectors and HID layer are portable Rust; only macOS-specific bits are the Keychain reader and hook paths. PRs welcome.

## License

- `app/`, `collector/`, `hooks/`, `docs/` — [MIT](LICENSE)
- `firmware/` — GPL-2.0 (derived from [QMK](https://github.com/qmk/qmk_firmware))
