#pragma once

// ============================================================
//  MindBuddy — ESP32 DevKit (bench-test companion for the Pi 5)
// ============================================================
//  Same UART protocol as the LilyGo build (firmware/shared/PROTOCOL.md).
//  No cellular modem — Dial / SMS pages are inert (the buttons still
//  emit link messages but the Pi ignores anything the modem would need).
//  Wi-Fi + captive portal (WiFiManager) still work from the TFT.

// ---- Pi 5 <-> ESP32 UART link ----
// Pi 5 side:  TX = GPIO14, RX = GPIO15  (see PROTOCOL.md)
// ESP32 side: RX = GPIO16, TX = GPIO17  (Serial1, remapped)
#define LINK_TX_PIN 17
#define LINK_RX_PIN 16
#define LINK_BAUD   115200

// ---- Physical UI ----
// GPIO0 (onboard BOOT button) is NOT broken out to the header pins on this
// ESP32 DevKit variant, so we wire an external momentary button between
// GPIO27 and GND (uses the MCU's internal pull-up). GPIO27 is a safe,
// non-strapping general-purpose pin exposed on the header.
// Short-press: wake / back.  Long-press: SOS.
#define TALK_BUTTON_PIN 27
#define LONG_PRESS_MS   1200

// ---- SD card slot on the TFT shield ----
// The 2.8" ILI9341 + XPT2046 shield exposes an SD slot on the same VSPI bus
// as the display (MISO=19, MOSI=23, SCK=18) with a dedicated chip-select on
// GPIO5. Change SD_CS_PIN if your board wires it elsewhere. The MindBuddy
// firmware uses this card to load backgrounds, icons, avatars and a theme
// file from disk instead of packing them into ESP32 DRAM. See:
//   firmware/esp32-devmodule/sdcard/README.txt
#ifndef SD_CS_PIN
  #define SD_CS_PIN 5
#endif
#define MB_ASSET_ROOT "/mindbuddy"

// ---- App identity ----
#define FW_VERSION "1.0.0-dev"
#define DEFAULT_DEVICE_CODE "0000000000000000"
#define WM_AP_NAME "WUF-Setup-Dev"
