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
  Serial.println(F("[wifi] mode=STA"));
  WiFi.mode(WIFI_STA);
  // Non-blocking: if there are saved creds, connect in the background; if
  // not, launch the portal but let setup() return so the UI + serial keep
  // running. Without this the whole boot sequence stalls silently for
  // up to 180s and the panel/monitor look "dead".
  wm.setConfigPortalBlocking(false);
  wm.setConfigPortalTimeout(180);
  wm.setAPCallback(portalCb);
  wm.setDebugOutput(true);
  Serial.println(F("[wifi] autoConnect() ..."));
  bool ok = wm.autoConnect(WM_AP_NAME);
  Serial.printf ("[wifi] autoConnect() returned %s\n", ok ? "true" : "false");
  s_connected = ok;
  link_bus::sendNet(ok, ok ? WiFi.RSSI() : -127, "wifi");
  if (ok) ui::goTo(ui::Page::Home);
}

void loop() {
  // Non-blocking WiFiManager needs its own process() call every loop
  // when the portal is up.
  wm.process();
  static uint32_t last = 0;
  if (millis() - last < 5000) return;
  last = millis();
  bool now = (WiFi.status() == WL_CONNECTED);
  if (now != s_connected) {
    s_connected = now;
    Serial.printf("[wifi] state change -> %s rssi=%d\n",
                  now ? "CONNECTED" : "DISCONNECTED",
                  now ? WiFi.RSSI() : -127);
    link_bus::sendNet(now, now ? WiFi.RSSI() : -127, "wifi");
    if (now) ui::goTo(ui::Page::Home);
  }
}

void factoryReset() { wm.resetSettings(); ESP.restart(); }
bool isConnected() { return s_connected; }
int  rssi()        { return WiFi.RSSI(); }
} // namespace
