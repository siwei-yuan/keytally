# Firmware (QMK keymap)

[中文版](README.zh-CN.md)

Target board: **GrayStudio Think6.5 V3** (`gray_studio/think65v3`, STM32F072,
6 WS2812 badge LEDs driven by `rgblight`, no per-key RGB).

```
common/           board-agnostic core (protocol, state machine, rgblight rendering)
think65v3/        Pro keymap source (VIA + usage lights); build.sh copies it into qmk_firmware
think65v3-plain/  clean VIA-only keymap (the "restore stock" fallback target)
build.sh          build / flash script
```

## Build & flash

One-time prerequisites:

```sh
brew tap osx-cross/arm && brew tap osx-cross/avr
brew trust qmk/qmk && brew trust osx-cross/arm && brew trust osx-cross/avr   # newer Homebrew requires this
brew install qmk/qmk/qmk
git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/qmk/qmk_firmware ~/qmk_firmware
qmk config user.qmk_home=$HOME/qmk_firmware
```

Then:

```sh
./build.sh          # compile → qmk_firmware/gray_studio_think65v3_usage_lights.bin (+ via_plain)
./build.sh flash    # compile and flash (enter DFU first: the app does this for you)
```

## Lighting scheme (6 LEDs, default roles)

- **LED 0, indicator**: source color (Claude coral / Codex teal); in quota mode it
  blinks red at 1 Hz once the weekly limit crosses your threshold; dim gray when the
  source isn't installed.
- **LEDs 1–5, progress bar**:
  - Quota mode: 5-hour window usage, green→red gradient; at least one segment lights
    once there's any usage.
  - Today mode: percentage of your daily budget, filled in the source color.
- **Activity mode**: all six breathe in the source color while the AI works (2.2 s);
  when idle the firmware **fully lets go** and your own rgblight settings show.
- If the app goes offline (unplug/quit), the firmware restores your lighting from
  EEPROM after 60 s.
- Roles are runtime-configurable from the app (click / drag-select LEDs); the
  compile-time table is just the factory default.

## Switching from the keyboard

The Fn layer binds `Fn+,` = cycle mode and `Fn+.` = toggle source
(`UL_KC_MODE`/`UL_KC_SRC`, i.e. `QK_KB_0`/`QK_KB_1` — rebindable in VIA via Any key).

## Behavior details

- Mode/source live in RAM and reset to quota/Claude on power loss; every change is
  reported back to the app so the UI stays in sync.
- VIA keymapping keeps working: our protocol occupies command IDs `0xC0–0xCF`,
  intercepted in `via_command_kb()` before VIA sees them.
- The upstream board code lights all six LEDs white while Caps Lock is on (an
  rgblight layer with higher priority) — expected behavior.

## Adapting a new board (community)

1. Copy `think65v3/` to a directory for your board; adjust
   `usage_lights_config.h` (LED index table) and the keymap; build with `./build.sh`
   (add your board to the script).
2. On the app side, register your VID/PID → firmware path in
   `app/src-tauri/src/flash.rs` and add the same VID/PID to `PRO_BOARDS`
   in `app/src/main.ts`.
3. Plug in → Settings → "Flash Pro firmware". Keymap/macros are backed up and
   restored automatically; the bootloader is entered via VIA `0x0B` (software,
   no case opening) with a temporary `Fn+Esc` fallback if the vendor firmware
   blocks the jump.

Boards with per-key RGB (`rgb_matrix`): the core module currently implements the
`rgblight` backend; an `rgb_matrix` variant existed pre-role-table (see git history)
and needs porting — contributions welcome.
