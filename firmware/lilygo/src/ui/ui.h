#pragma once
#include <lvgl.h>

namespace ui {
void begin();
void tick();

// Pages
enum class Page { Splash, WifiSetup, Home, Chat, Modes, Language, Meds, Music, Dial, Sms, Settings };
void goTo(Page p);
Page current();
void back();  // used by the Talk button

// Chat helpers driven by link messages
void chatAppendUser(const char* text);
void chatAppendAi(const char* text);
void chatSetPending(const char* text);   // shows "thinking..." bubble
void chatClearPending();

// Wifi setup screen text
void wifiSetPortalInfo(const char* line1, const char* line2, const char* line3);

// Small toast (used for errors)
void toast(const char* text);
}
