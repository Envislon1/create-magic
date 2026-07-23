MindBuddy — TFT Assets SD Card
==============================

This is the folder tree that the ESP32 DevModule firmware expects to find on
an SD card plugged into the 2.8" ILI9341 shield's built-in slot.

Card requirements
-----------------
- Any size from 512 MB up to 32 GB works. An 8 GB card is a safe default.
- Format: FAT32, MBR partition table, allocation unit 32 KB.
- Copy the entire "mindbuddy/" folder to the ROOT of the card.

Folder layout (under /mindbuddy/)
---------------------------------
theme.json              -> colors + tagline (hot-editable, reloaded at boot)
backgrounds/            -> 240x320 RGB565 LVGL binary images, one per page
                           splash.bin  home.bin  chat.bin  modes.bin  meds.bin
                           music.bin   dial.bin  sms.bin   settings.bin  wifi.bin
icons/nav/              -> 32x32 nav bar tiles: home, brain, chat, music,
                           bell, sos, settings  (used on the home screen)
icons/actions/          -> 48x48 action glyphs: talk, mic, send, back, plus,
                           check, sliders
icons/media/            -> 40x40 media transport: play, pause, prev, next,
                           volume
icons/phone/            -> 40x40 phone glyphs: call, hangup, incoming, missed,
                           outgoing
icons/status/           -> 16x16 status-bar: wifi, wifi_off, battery, signal,
                           clock
icons/moods/            -> 40x40 mood tiles: heart, shield, zap, moon, sun,
                           wind, refresh   (support-mode picker)
avatars/                -> 96x96 buddy: buddy_idle.bin, buddy_listen.bin,
                           buddy_think.bin, buddy_speak.bin
fonts/                  -> LVGL binary fonts (optional): figtree_16.bin,
                           figtree_20.bin, dmmono_12.bin
sounds/                 -> Played by the Pi 5, referenced by filename here:
                           alarm.wav  medication.wav  incoming_call.wav
                           message.wav  sos.wav

Everything is OPTIONAL
----------------------
If a file is missing (or the whole card is missing), the firmware falls back
to flat-color rendering + built-in Montserrat text, so the board still boots
and every page still works. Add files a folder at a time and reboot to see
the change.

Regenerating assets from source PNGs
------------------------------------
See ../tools/convert_assets.py in the repo. Drop new PNGs into
firmware/esp32-devmodule/sdcard-src/<subfolder>/ and run:

    python3 tools/convert_assets.py

It rewrites the matching .bin files under sdcard/mindbuddy/. Copy the whole
folder to the card afterwards.
