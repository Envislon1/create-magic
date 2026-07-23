# MindBuddy — ESP32 DevKit companion firmware

A bench-test build of the LilyGo TFT firmware for a plain **ESP32 DevKit-V1
(WROOM-32)** wired to a cheap **2.8" ILI9341 + XPT2046** shield. It speaks
the same UART protocol as the LilyGo board (`firmware/shared/PROTOCOL.md`),
so it plugs straight into the Pi 5 `mbd` debug mode: every chat line, mode
change, pipeline switch and toast that the real hardware would show also
shows here.

What works:
- Wi-Fi captive portal via WiFiManager (`WUF-Setup-Dev` AP + auto-portal)
- TFT UI: Splash, Home, Chat, Modes, Meds, Music, Settings (volume /
  pipeline / TTS engine / voice)
- External GPIO27 talk button: short = Wake / Back, long ≥ 1.2 s = SOS
- Pi 5 UART link at 115200 8N1, JSON-per-line

What is intentionally missing (no modem on this board):
- Placing / receiving voice calls
- Sending SMS (incoming SMS from the Pi still renders on the TFT)
- Mic and speaker (those live on the LilyGo build)

## Wiring

| Signal        | ESP32 pin | Notes                            |
|---------------|-----------|----------------------------------|
| TFT MISO      | GPIO19    | ILI9341 HSPI                     |
| TFT MOSI      | GPIO23    |                                  |
| TFT SCLK      | GPIO18    |                                  |
| TFT CS        | GPIO32    | safe non-strapping pin           |
| TFT DC        | GPIO22    | safe non-strapping pin           |
| TFT RST       | GPIO21    | safe non-strapping pin           |
| TFT BL        | GPIO26    | backlight, safe non-strapping pin |
| Touch CS      | GPIO33    | XPT2046, shares SPI              |
| Talk button   | GPIO27    | external button to GND (BOOT not on header) |
| UART TX → Pi  | GPIO17    | to Pi 5 GPIO15 (RX)              |
| UART RX ← Pi  | GPIO16    | from Pi 5 GPIO14 (TX)            |
| GND           | GND       | common ground with the Pi 5      |

If your shield uses different pins, edit `build_flags` in `platformio.ini`
(the TFT_eSPI `User_Setup` is defined there — do **not** edit the vendored
library's `User_Setup.h`).

Avoid wiring TFT control lines to ESP32 boot-strapping pins: **GPIO0, GPIO2,
GPIO4, GPIO5, GPIO12, GPIO15**. Some TFT modules pull CS/RST/DC/BL high or low
at reset, which can stop the ESP32 from booting or suppress boot serial logs.

> **Exception:** the SD-card slot's CS on the standard 2.8" ILI9341+XPT2046+SD
> shield sits on **GPIO5**. That's a strapping pin, but only the CS line is on
> it and the card leaves CS floating at boot, so it doesn't affect strap
> state. If you moved the SD's CS to a different pin, override it with
> `-DSD_CS_PIN=<pin>` in `platformio.ini`.

## SD card assets (backgrounds, icons, avatars, theme)

The firmware loads its polished visuals from an SD card in the TFT shield's
built-in slot instead of packing them into ESP32 DRAM. This is what makes
the on-board UI match the "MindBuddy TFT Screen Pages" Figma design without
crowding out Wi-Fi / WiFiManager.

**Preparing the card (any 512 MB – 32 GB card works; 8 GB is fine):**

1. Format the card as **FAT32**, MBR partition table, 32 KB allocation unit.
2. Copy the entire `sdcard/mindbuddy/` folder from this repo to the **root**
   of the card. You should end up with `/mindbuddy/theme.json`,
   `/mindbuddy/backgrounds/…`, `/mindbuddy/icons/…`, etc.
3. Slide the card into the shield and boot the board.

The splash screen prints `SD:ok` if the card was found, `SD:off` otherwise.
Anything missing on the card silently falls back to flat-color rendering, so
you can add assets one folder at a time.

**Editing the theme:** open `sdcard/mindbuddy/theme.json` in any editor,
change the hex values, save. The palette is re-read on every boot.

**Regenerating art:** drop replacement PNGs into `sdcard-src/<subfolder>/`
using the sizing table in `sdcard-src/README.md`, then run:

```
python3 tools/convert_assets.py
```

That rewrites the `.bin` files under `sdcard/mindbuddy/`. Copy the folder to
the card again.

Full expected file list and sizes are in `sdcard/README.txt`.


## Build

```
cd firmware/esp32-devmodule
pio run -t upload
pio device monitor
```

If the serial monitor stays blank, first upload the board-only smoke test:

```
pio run -e esp32dev-smoke -t upload
pio device monitor -e esp32dev-smoke
```

Press **EN/RST** after the monitor opens. You should see `[smoke]` lines once
per second and the onboard LED should blink. If the smoke test is also silent,
disconnect the TFT/touch wiring and retry; the problem is then power, USB data
cable/port, serial port selection, EN/GPIO0 boot state, or a strap pin still
being held at the wrong level — not the MindBuddy firmware size.

## First boot

1. Board comes up on the Splash page.
2. If no Wi-Fi is saved it opens a captive portal — join `WUF-Setup-Dev`
   on your phone, pick your network. The TFT shows the same instructions.
3. Once connected it jumps to Home.
4. Start the Pi 5 side with `mbd` (debug mode). Pick a mode + language +
   pipeline in the REPL and you should immediately see the chat feed,
   backend badge and latency mirror on the TFT.

## Protocol

Identical to the LilyGo board. See `firmware/shared/PROTOCOL.md`. Messages
related to `call_*` / `sms_incoming` still round-trip but there is no radio
on this build, so the Pi will just log them.