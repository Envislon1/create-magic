#pragma once
#include <lvgl.h>

// SD-card asset provider for the ESP32 DevModule.
//
//   /mindbuddy/backgrounds/<page>.bin
//   /mindbuddy/icons/<group>/<name>.bin
//   /mindbuddy/avatars/<state>.bin
//   /mindbuddy/theme.json
//
// The card is mounted through Arduino's SD library and exposed to LVGL via
// a filesystem driver on drive letter 'S', so anywhere LVGL accepts an
// image source string you can pass "S:backgrounds/home.bin".
//
// Everything is optional. If the card is missing, or a specific file is
// missing, assets::bg()/icon()/avatar() return nullptr and callers fall
// back to flat-color rendering.
namespace assets {

enum class Bg {
  Splash, Wifi, Home, Chat, Modes, Meds, Music, Dial, Sms, Settings
};

enum class AvatarState { Idle, Listen, Think, Speak };

// Mount SD, register LVGL FS driver, load theme.json.
// Safe to call more than once; safe to call before or after lv_init()
// (it defers driver registration if LVGL isn't ready yet — but call it
// AFTER lv_init() for immediate availability).
void begin();

bool ready();

// LVGL image source strings — "S:backgrounds/home.bin" style. nullptr
// means "no file on card; use fallback rendering".
const char* bg(Bg page);
const char* icon(const char* group, const char* name); // e.g. ("nav","home")
const char* avatar(AvatarState s);

} // namespace assets
