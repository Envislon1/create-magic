
# SD-Card–backed UI for the ESP32 DevModule

Goal: stop building every screen from scratch in ESP32 DRAM. Instead ship a themed UI that mirrors `MindBuddy TFT Screen Pages` and load all heavy visuals (backgrounds, icons, avatars, tones) from a FAT-formatted 8 GB SD card plugged into the TFT module's built-in slot.

Only the `firmware/esp32-devmodule/` build is touched. LilyGo firmware, Pi code, and the web app are unchanged.

## What ships

### 1. SD card asset layout (copy this to the card root)

Created as `firmware/esp32-devmodule/sdcard/` in the repo so you can drag-drop it onto the card:

```text
/mindbuddy/
├── theme.json                  # colors, fonts, layout offsets (mirrors Figma tokens)
├── backgrounds/
│   ├── splash.bin              # 240x320 RGB565 LVGL binary
│   ├── home.bin
│   ├── chat.bin
│   ├── modes.bin
│   ├── meds.bin
│   ├── music.bin
│   ├── dial.bin
│   ├── sms.bin
│   ├── settings.bin
│   └── wifi.bin
├── icons/
│   ├── nav/                    # 32x32 bottom-nav (home, brain, chat, music, bell, sos, settings)
│   ├── actions/                # 48x48 (talk, mic, send, back, plus, check, sliders)
│   ├── media/                  # play, pause, next, prev, volume
│   ├── phone/                  # call, incoming, missed, outgoing, dial-pad glyphs
│   ├── status/                 # wifi, battery, clock, signal
│   └── moods/                  # heart, shield, zap, moon, sun, wind (support-mode tiles)
├── avatars/
│   ├── buddy_idle.bin
│   ├── buddy_listen.bin
│   ├── buddy_think.bin
│   └── buddy_speak.bin
├── fonts/
│   ├── figtree_16.bin          # LVGL binary font (converted from Figtree)
│   ├── figtree_20.bin
│   └── dmmono_12.bin
├── sounds/                     # played via the Pi; ESP32 just references paths
│   ├── alarm.wav
│   ├── medication.wav
│   ├── incoming_call.wav
│   ├── message.wav
│   └── sos.wav
└── README.txt                  # tells the user how to (re)generate assets
```

A `tools/convert_assets.py` helper (Pillow + LVGL image converter CLI) generates every `.bin` from source PNGs under `firmware/esp32-devmodule/sdcard-src/`. Placeholder PNGs (solid theme-colored panels + labeled icon tiles) ship in that source folder so the card is usable immediately; you can replace the PNGs with polished art and re-run the script.

### 2. Firmware changes (`firmware/esp32-devmodule/`)

- `platformio.ini`
  - Add `SD` and `FS` libs (bundled with the Arduino-ESP32 core, just enable them).
  - Add `-DUSE_SD_ASSETS=1` and pin defines for the TFT's SD slot (`SD_CS=5` on the common 2.8" ILI9341+XPT2046+SD shield; documented in a comment so you can adjust).
- `include/config.h`
  - New `SD_CS_PIN`, `MB_ASSET_ROOT "/mindbuddy"` constants and path helpers.
- `src/ui/assets.h` / `src/ui/assets.cpp` (new)
  - `assets::begin()` mounts the SD card, opens `theme.json`, and registers an LVGL filesystem driver (`'S'` drive) that maps `S:/…` → `SD.open("/mindbuddy/…")` — this is the officially supported way to stream LVGL images off disk with almost zero RAM cost.
  - `assets::bg(Page)`, `assets::icon(const char*)`, `assets::avatar(state)` return `const char*` LVGL src strings such as `"S:/backgrounds/home.bin"`.
  - Graceful fallback: if the card is missing or a file is absent, we log once and fall back to the current flat-color rendering so the board never bricks.
- `src/ui/theme.h` (new) — parsed once from `theme.json` (bg, surface, primary/teal `#5eb8b0`, danger, text, muted). All page builders read colors from here instead of hardcoded hex.
- `src/ui/ui.cpp` — full rewrite of the page builders to match the Figma layout:
  - Each page uses `lv_image_create` with an `S:/backgrounds/<page>.bin` as the base layer.
  - Buttons/tiles switch from bare `lv_button` + text to icon+label tiles using `assets::icon()`; the bottom nav on Home mirrors the Figma nav bar (Home, Brain, Chat, Music, Bell, SOS, Settings).
  - Chat page gets bubbles, buddy avatar swapping on state, and the mic/send row from the Figma chat screen.
  - Splash renders the SD-loaded logo instead of two `lv_label`s.
  - We keep the existing link-bus hooks (`chatAppendUser/Ai`, `refresh_home`, `toast`) so `main.cpp` and the Pi protocol don't change.
- `src/main.cpp` — call `assets::begin()` right before `ui::begin()`; leave button/SOS/UART logic alone.

### 3. Docs

- `firmware/esp32-devmodule/README.md` gains an "SD card assets" section: how to format the card (FAT32, MBR), how to copy `sdcard/` to the root, and how to regenerate visuals with `tools/convert_assets.py`.
- `firmware/esp32-devmodule/sdcard/README.txt` gives the same info to whoever holds only the card.

## Technical notes

- LVGL 9's filesystem API: `lv_fs_drv_register` with open/close/read/seek callbacks backed by `SD.open()`. Images referenced as `"S:/…"` are decoded on demand so we never load a whole 240×320 frame into DRAM.
- Images are LVGL binary format (RGB565, no alpha for backgrounds, RGB565A8 for icons). The `convert_assets.py` script wraps `LVGLImage.py` from the LVGL repo.
- SD and TFT_eSPI share VSPI on this shield; TFT_eSPI's own SPI transactions already `beginTransaction`/`endTransaction`, and the Arduino `SD` library does too, so they coexist. We init the SD *after* the TFT so the SD library sees a working bus.
- Fallback path guarantees that a missing/blank card still boots to a functional (if plain) UI — critical for bench debugging.
- No behavioral change to link bus, state machine, Wi-Fi manager, SOS button, or Pi protocol.

## Deliverables checklist

- New files: `src/ui/assets.{h,cpp}`, `src/ui/theme.{h,cpp}`, `sdcard/**`, `sdcard-src/**`, `tools/convert_assets.py`.
- Rewritten: `src/ui/ui.cpp`, `platformio.ini`, `include/config.h`, `README.md`, `src/main.cpp` (one-liner).
- Untouched: everything outside `firmware/esp32-devmodule/`.
