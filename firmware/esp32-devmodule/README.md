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