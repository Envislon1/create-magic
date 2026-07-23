#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"
#include "state.h"
#include "ui/ui.h"
#include "link/link_bus.h"
#include "net/wifi_mgr.h"
#include "net/modem.h"

// ---- Talk button (BACK on non-home, long-press = SOS) ----
static uint32_t btn_down_at = 0;
static bool     btn_prev    = false;
static bool     long_fired  = false;

static void handleButton() {
  bool pressed = digitalRead(TALK_BUTTON_PIN) == LOW;
  uint32_t now = millis();
  if (pressed && !btn_prev) { btn_down_at = now; long_fired = false; }
  if (pressed && !long_fired && now - btn_down_at >= LONG_PRESS_MS) {
    long_fired = true;
    app_state::sos_active = true;
    link_bus::sendSosTrigger("Long-press on device");
    ui::toast("SOS sent");
    app_state::notifyChanged();
  }
  if (!pressed && btn_prev && !long_fired) {
    // short click
    if (ui::current() == ui::Page::Home) {
      link_bus::sendWake();
      ui::goTo(ui::Page::Chat);
    } else {
      ui::back();
    }
  }
  btn_prev = pressed;
}

// ---- Pi messages ----
static void onPi(const JsonDocument& doc) {
  const char* t = doc["type"] | "";
  if (!strcmp(t, "state")) {
    app_state::listening = doc["listening"] | false;
    app_state::thinking  = doc["thinking"]  | false;
    app_state::speaking  = doc["speaking"]  | false;
    const char* b = doc["backend"] | "local";
    app_state::backend = b;
    if (doc["pipeline"].is<const char*>())   app_state::pipeline   = (const char*)doc["pipeline"];
    if (doc["tts_engine"].is<const char*>()) app_state::tts_engine = (const char*)doc["tts_engine"];
    if (doc["cloud_ready"].is<bool>())       app_state::cloud_ready = doc["cloud_ready"] | false;
    if (app_state::thinking) ui::chatSetPending("Thinking...");
    else                     ui::chatClearPending();
    app_state::notifyChanged();
  } else if (!strcmp(t, "chat_user")) {
    ui::chatAppendUser(doc["text"] | "");
  } else if (!strcmp(t, "chat_ai_final")) {
    if (doc["elapsed_ms"].is<int>())    app_state::last_reply_ms = doc["elapsed_ms"] | 0;
    if (doc["backend"].is<const char*>()) app_state::backend = (const char*)doc["backend"];
    ui::chatAppendAi(doc["text"] | "");
    app_state::notifyChanged();
  } else if (!strcmp(t, "chat_ai_meta")) {
    app_state::last_reply_ms = doc["elapsed_ms"] | 0;
    if (doc["backend"].is<const char*>())  app_state::backend  = (const char*)doc["backend"];
    if (doc["pipeline"].is<const char*>()) app_state::pipeline = (const char*)doc["pipeline"];
    app_state::notifyChanged();
  } else if (!strcmp(t, "mode")) {
    app_state::mode = (const char*)(doc["mode"] | "ANXIETY");
    app_state::notifyChanged();
  } else if (!strcmp(t, "language")) {
    app_state::language = (const char*)(doc["language"] | "en");
    app_state::notifyChanged();
  } else if (!strcmp(t, "sos_state")) {
    app_state::sos_active = doc["active"] | false;
    app_state::notifyChanged();
  } else if (!strcmp(t, "volume")) {
    app_state::volume = doc["volume"] | app_state::volume;
  } else if (!strcmp(t, "meds")) {
    app_state::med_count = 0;
    for (JsonVariantConst v : doc["items"].as<JsonArrayConst>()) {
      if (app_state::med_count >= 8) break;
      auto& m = app_state::meds[app_state::med_count++];
      m.hour    = v["hour"]    | 8;
      m.minute  = v["minute"]  | 0;
      m.enabled = v["enabled"] | true;
      m.label   = (const char*)(v["label"] | "");
    }
  } else if (!strcmp(t, "music_state")) {
    app_state::music_playing = doc["playing"] | false;
    app_state::music_title   = (const char*)(doc["title"] | "");
  } else if (!strcmp(t, "error")) {
    ui::toast(doc["msg"] | "error");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TALK_BUTTON_PIN, INPUT_PULLUP);

  ui::begin();
  link_bus::begin(onPi);
  wifi_mgr::begin();
  modem_mgr::begin();
}

void loop() {
  ui::tick();
  link_bus::loop();
  wifi_mgr::loop();
  modem_mgr::loop();
  handleButton();
  delay(3);
}
