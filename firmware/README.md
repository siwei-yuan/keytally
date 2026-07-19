# Firmware (QMK keymap)

[中文版](README.zh-CN.md)

Reference boards (both fully wired into the app's one-click flash):

| Board | MCU | Tree | LEDs | Flash tool |
|---|---|---|---|---|
| GrayStudio Think6.5 V3 (`gray_studio/think65v3`) | STM32F072 | mainline QMK | 6 WS2812 badge | `dfu-util` |
| Percent Skog Reboot (`bioi/skog_reboot`) | AVR at90usb646/1286 (rev A/B) | [scottywei fork](https://github.com/scottywei/qmk_firmware/tree/update-and-add-bioi-keyboards) (BLE duo-mode) | 10 WS2812 (5 strip + 5 bottom logo) | `dfu-programmer` |

```
common/           board-agnostic core (protocol, state machine, rgblight rendering)
think65v3/        Think6.5 V3 Pro keymap (VIA + usage lights)
think65v3-plain/  clean VIA-only keymap (the Think65 "restore stock" fallback target)
skog_reboot/      Skog Reboot Pro keymap (VIA + usage lights + BLE kept intact)
build.sh          build / flash script (builds every board it finds a tree for)
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

### Skog Reboot extras

The Skog Reboot only builds inside scottywei's QMK fork (its BLE duo-mode needs
custom `main.c`/`ble.c`/`usart.c`), so `build.sh` looks for the fork at
`~/qmk_firmware-bioi` and skips the board if absent:

```sh
brew install osx-cross/avr/avr-gcc@8 avr-binutils dfu-programmer
git clone --depth 1 -b update-and-add-bioi-keyboards \
    https://github.com/scottywei/qmk_firmware ~/qmk_firmware-bioi
cd ~/qmk_firmware-bioi && git submodule update --init --depth 1 lib/lufa lib/printf
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt qmk
```

`build.sh` produces `bioi_skog_reboot_rev_{a,b}_usage_lights.hex` for both hardware
revisions; at flash time the app probes the chip in DFU (`dfu-programmer <mcu> get`)
and picks the right one. Two Skog-specific fixes live in the keymap:
the vendor tree sets `WS2812_BYTE_ORDER_RGB`, which swaps red/green on the actual
GRB LEDs (confirmed on hardware), so our `config.h` restores the GRB default; and
the 2023-era fork predates the `RGBLIGHT_LED_COUNT`/`rgb_t` renames, so
`usage_lights_config.h` carries tiny compat shims. "Restore stock" flashes the
official v1.2 release hex from
[percent-skog-reboot Releases](https://github.com/scottywei/percent-skog-reboot/releases).

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

Two tiers — pick how deep you want to go:

### Tier 1 — calibration only, no flashing (~2 min)

Teach the app where your board's LEDs physically sit. Add an entry to
`app/src/profiles.json` keyed by `vid:pid`:

```jsonc
"8101:5352": {
  "name": "Percent Skog Reboot",
  "layout": "tkl87",                    // 60 | 65 | tkl87 | 96 | 104
  "leds": [
    { "x": 15.4, "y": 4.0 },            // key-unit coords, face defaults to "top"
    { "x": 8.0, "y": 6.2, "face": "bottom" }  // side/bottom LEDs: counted, not drawn
  ]
}
```

Coordinates are in key units (1u = one key). Calibrate against the physical board —
the UI shows a `CALIBRATED · JSON` tag so users know the provenance. List LEDs in
**chain order with `face:"top"` first**; that keeps UI dot indices aligned with
firmware LED indices if a Pro port follows later. PR just this file.

### Tier 2 — Pro firmware (per-LED control, keyboard-side switching)

1. Copy `think65v3/` (mainline boards) or `skog_reboot/` (vendor-fork boards) as a
   template; adjust `usage_lights_config.h` (default LED roles) and the keymap;
   add your board to `build.sh`.
2. App side: register VID/PID → `FlashJob` in `app/src-tauri/src/flash.rs`
   (`Stm32Bin` for dfu-util targets, `AvrHex` with chip candidates for
   dfu-programmer targets, one per hardware rev), and add the VID/PID to
   `PRO_BOARDS` in `app/src/main.ts`.
3. Plug in → Settings → "Flash Pro firmware". Keymap/macros are backed up and
   restored automatically; the bootloader is entered via VIA `0x0B` (software,
   no case opening) with a temporary `Fn+Esc` fallback if the vendor firmware
   blocks the jump.

If your board already has a Tier 1 profile, the Pro UI reuses it: per-LED
click/drag role editing happens right on the calibrated layout.

Boards with per-key RGB (`rgb_matrix`): the core module currently implements the
`rgblight` backend; an `rgb_matrix` variant existed pre-role-table (see git history)
and needs porting — contributions welcome.
