#include "ui/theme.h"
#include "config.h"
#include <Arduino.h>
#include <SD.h>
#include <ArduinoJson.h>

namespace {

theme::Palette g_p;
String         g_brand   = "MindBuddy";
String         g_tagline = "your calm companion";

static lv_color_t hex(uint32_t v) { return lv_color_hex(v); }

static uint32_t parse_hex(const char* s, uint32_t fallback) {
  if (!s || !*s) return fallback;
  if (*s == '#') s++;
  char* end = nullptr;
  unsigned long v = strtoul(s, &end, 16);
  if (end == s) return fallback;
  return (uint32_t)v;
}

static void set_defaults() {
  g_p.bg          = hex(0x0e1420);
  g_p.surface     = hex(0x161d2b);
  g_p.surface2    = hex(0x1c2536);
  g_p.primary     = hex(0x5eb8b0);
  g_p.primaryDim  = hex(0x3f8781);
  g_p.accent      = hex(0x7bd3ca);
  g_p.danger      = hex(0xe6604a);
  g_p.warn        = hex(0xf2a44a);
  g_p.ok          = hex(0x4ec38a);
  g_p.text        = hex(0xe8edf5);
  g_p.muted       = hex(0x6b7a99);
  g_p.userBubble  = hex(0x2e8b57);
  g_p.aiBubble    = hex(0x1c2536);
}

} // namespace

namespace theme {

void load() {
  set_defaults();
  File f = SD.open(MB_ASSET_ROOT "/theme.json", FILE_READ);
  if (!f) {
    Serial.println(F("[theme] theme.json not on SD — using defaults"));
    return;
  }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial.printf("[theme] parse error: %s — using defaults\n", err.c_str());
    return;
  }
  JsonObject c = doc["colors"].as<JsonObject>();
  if (!c.isNull()) {
    g_p.bg          = hex(parse_hex(c["bg"]         | (const char*)nullptr, 0x0e1420));
    g_p.surface     = hex(parse_hex(c["surface"]    | (const char*)nullptr, 0x161d2b));
    g_p.surface2    = hex(parse_hex(c["surface2"]   | (const char*)nullptr, 0x1c2536));
    g_p.primary     = hex(parse_hex(c["primary"]    | (const char*)nullptr, 0x5eb8b0));
    g_p.primaryDim  = hex(parse_hex(c["primaryDim"] | (const char*)nullptr, 0x3f8781));
    g_p.accent      = hex(parse_hex(c["accent"]     | (const char*)nullptr, 0x7bd3ca));
    g_p.danger      = hex(parse_hex(c["danger"]     | (const char*)nullptr, 0xe6604a));
    g_p.warn        = hex(parse_hex(c["warn"]       | (const char*)nullptr, 0xf2a44a));
    g_p.ok          = hex(parse_hex(c["ok"]         | (const char*)nullptr, 0x4ec38a));
    g_p.text        = hex(parse_hex(c["text"]       | (const char*)nullptr, 0xe8edf5));
    g_p.muted       = hex(parse_hex(c["muted"]      | (const char*)nullptr, 0x6b7a99));
    g_p.userBubble  = hex(parse_hex(c["userBubble"] | (const char*)nullptr, 0x2e8b57));
    g_p.aiBubble    = hex(parse_hex(c["aiBubble"]   | (const char*)nullptr, 0x1c2536));
  }
  JsonObject s = doc["splash"].as<JsonObject>();
  if (!s.isNull()) {
    const char* b = s["brand"]   | (const char*)nullptr;
    const char* t = s["tagline"] | (const char*)nullptr;
    if (b) g_brand = b;
    if (t) g_tagline = t;
  }
  Serial.println(F("[theme] loaded from SD"));
}

const Palette& p()       { return g_p; }
const char*    brand()   { return g_brand.c_str(); }
const char*    tagline() { return g_tagline.c_str(); }

} // namespace theme
