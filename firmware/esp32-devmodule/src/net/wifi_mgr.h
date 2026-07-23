#pragma once
namespace wifi_mgr {
void begin();      // tries saved creds, else launches portal + writes OLED-style status to TFT
void loop();
void factoryReset();
bool isConnected();
int  rssi();
}
