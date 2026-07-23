#include "net/wifi_mgr.h"
#include "ui/ui.h"
#include "config.h"
#include "link/link_bus.h"
#include <WiFi.h>
#include <WiFiManager.h>

namespace wifi_mgr {
static WiFiManager wm;
static bool s_connected = false;

static void portalCb(WiFiManager*) {
  IPAddress ip = WiFi.softAPIP();
  char line3[48];
  snprintf(line3, sizeof(line3), "3. Open http://%s", ip.toString().c_str());
  ui::goTo(ui::Page::WifiSetup);
  ui::wifiSetPortalInfo(
    "1. Join Wi-Fi \"" WM_AP_NAME "\"",
    "2. Portal opens automatically",
    line3);
}

void begin() {
  WiFi.mode(WIFI_STA);
  wm.setConfigPortalTimeout(180);
  wm.setAPCallback(portalCb);
  wm.setDebugOutput(false);
  bool ok = wm.autoConnect(WM_AP_NAME);
  s_connected = ok;
  link_bus::sendNet(ok, ok ? WiFi.RSSI() : -127, "wifi");
  if (ok) ui::goTo(ui::Page::Home);
}

void loop() {
  static uint32_t last = 0;
  if (millis() - last < 5000) return;
  last = millis();
  bool now = (WiFi.status() == WL_CONNECTED);
  if (now != s_connected) {
    s_connected = now;
    link_bus::sendNet(now, now ? WiFi.RSSI() : -127, "wifi");
  }
}

void factoryReset() { wm.resetSettings(); ESP.restart(); }
bool isConnected() { return s_connected; }
int  rssi()        { return WiFi.RSSI(); }
} // namespace
