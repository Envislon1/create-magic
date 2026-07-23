// MindBuddy — ESP32 DevKit companion firmware.
// Mirrors the LilyGo build minus the cellular modem so we can bench-test
// the Pi 5 <-> board UART link, chat UI and Wi-Fi captive portal while we
// wait for the mic + speaker hardware to arrive.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <soc/soc.h>
#include <soc/rtc_cntl_reg.h>

#include "config.h"
#include "state.h"
#include "ui/ui.h"
#include "link/link_bus.h"
#include "net/wifi_mgr.h"

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
    link_bus::sendSosTrigger("Long-press on dev board");
    ui::toast("SOS sent");
    app_state::notifyChanged();
  }
  if (!pressed && btn_prev && !long_fired) {
    if (ui::current() == ui::Page::Home) {
      link_bus::sendWake();
      ui::goTo(ui::Page::Chat);
    } else {
      ui::back();
    }
  }
  btn_prev = pressed;
}

// ---- Pi messages (identical handling to the LilyGo build) ----
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
    if (doc["elapsed_ms"].is<int>())      app_state::last_reply_ms = doc["elapsed_ms"] | 0;
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
  // Note: call_incoming / sms_incoming will still render toasts on the TFT,
  // but this board has no modem so no actual call/SMS can be placed.
}

void setup() {
  // Disable the RTC brownout detector BEFORE bringing up the display + Wi-Fi.
  // On plain ESP32 DevKits powered from USB, the current spike when the TFT
  // backlight lights up and Wi-Fi radio calibrates is enough to dip Vcc below
  // the BOD threshold. When that happens the chip resets before setup() has
  // printed anything, and both the Serial monitor and the TFT stay blank —
  // exactly what we saw here. The smoke test never hits this because it
  // powers neither the panel nor the radio.
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial.flush();
  // Give USB-CDC / host monitor a moment to attach before the first prints.
  delay(400);
  Serial.println();
  Serial.println(F("========================================"));
  Serial.println(F("[boot] MindBuddy ESP32 DevKit starting"));
  Serial.printf ("[boot] fw=%s  reset_reason=%d\n", FW_VERSION, (int)esp_reset_reason());
  Serial.printf ("[boot] free heap=%u\n", (unsigned)ESP.getFreeHeap());
  Serial.println(F("[boot] If you see NOTHING before this line: the app image"));
  Serial.println(F("[boot] is bootlooping. Most common causes on this board:"));
  Serial.println(F("[boot]   * app overflows the flash partition (fixed:"));
  Serial.println(F("[boot]     platformio.ini now uses huge_app.csv)"));
  Serial.println(F("[boot]   * USB power brownout when TFT+Wi-Fi start up"));
  Serial.println(F("[boot]     (fixed: BOD disabled above; also try a"));
  Serial.println(F("[boot]     powered USB hub or the 5V pin)"));
  Serial.println(F("[boot]   * a strap pin (GPIO0/2/5/12/15) held wrong"));
  Serial.println(F("========================================"));
  Serial.flush();

  pinMode(TALK_BUTTON_PIN, INPUT_PULLUP);
  delay(5);
  Serial.printf("[boot] TALK_BUTTON_PIN (GPIO%d) level at boot = %s\n",
                TALK_BUTTON_PIN,
                digitalRead(TALK_BUTTON_PIN) == LOW ? "LOW (button held?)" : "HIGH (ok)");
  Serial.flush();

  Serial.println(F("[boot] ui::begin() ..."));
  Serial.flush();
  ui::begin();
  Serial.println(F("[boot] ui::begin() done"));

  Serial.println(F("[boot] link_bus::begin() ..."));
  Serial.flush();
  link_bus::begin(onPi);
  Serial.println(F("[boot] link_bus::begin() done"));

  // Wi-Fi is intentionally NOT started here. WiFiManager::autoConnect() can
  // pull enough current to brown out a USB-only board mid-init, and even
  // with setConfigPortalBlocking(false) it does a synchronous scan first.
  // Deferring it to loop() means the UI + Serial are already alive if it
  // does misbehave, so we can actually see what happened.
  Serial.println(F("[boot] setup() done — Wi-Fi will start from loop()"));
}

void loop() {
  static bool     s_wifi_started = false;
  static uint32_t s_last_beat    = 0;
  uint32_t now = millis();

  if (!s_wifi_started && now > 1500) {
    s_wifi_started = true;
    Serial.println(F("[boot] wifi_mgr::begin() (deferred) ..."));
    Serial.flush();
    wifi_mgr::begin();
    Serial.println(F("[boot] wifi_mgr::begin() done"));
  }

  if (now - s_last_beat >= 2000) {
    s_last_beat = now;
    Serial.printf("[beat] up=%lus  heap=%u  page=%d\n",
                  (unsigned long)(now / 1000),
                  (unsigned)ESP.getFreeHeap(),
                  (int)ui::current());
  }
  ui::tick();
  link_bus::loop();
  if (s_wifi_started) wifi_mgr::loop();
  handleButton();
  delay(3);
}