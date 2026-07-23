#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <functional>

namespace link_bus {
using Handler = std::function<void(const JsonDocument&)>;

void begin(Handler on_msg);
void loop();

// Convenience senders
void send(const JsonDocument& msg);
void sendModeSet(const char* mode);
void sendLanguageSet(const char* language);
void sendVolume(int v);
void sendVoice(const char* voice);
void sendCloud(bool cloud);
void sendPipeline(const char* pipeline);   // "auto" | "online" | "offline"
void sendTtsEngine(const char* engine);    // "kokoro" | "piper"
void sendNet(bool online, int rssi, const char* mode);
void sendCallIncoming(const char* from);
void sendCallAnswered(const char* from);
void sendCallEnded();
void sendSmsIncoming(const char* from, const char* text);
void sendSosTrigger(const char* note);
void sendSosResolve();
void sendWake();
void sendTextPrompt(const char* text);
void sendMusic(const char* cmd, const char* query = nullptr);
}
