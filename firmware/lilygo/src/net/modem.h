#pragma once
namespace modem_mgr {
void begin();
void loop();
bool dial(const char* number);
void hangup();
bool sendSms(const char* to, const char* text);
}
