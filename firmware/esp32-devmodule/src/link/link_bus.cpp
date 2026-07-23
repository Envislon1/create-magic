#include "link/link_bus.h"
#include "config.h"

namespace link_bus {
static Handler s_handler;
static String  s_rx;
static uint32_t s_last_ping = 0;

void begin(Handler on_msg) {
  s_handler = on_msg;
  Serial1.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);
  s_rx.reserve(512);
  JsonDocument boot;
  boot["type"] = "boot";
  boot["fw"]   = FW_VERSION;
  boot["modem"] = "A7670";
  send(boot);
}

void send(const JsonDocument& msg) {
  JsonDocument out; out.set(msg);
  out["src"] = "lg";
  serializeJson(out, Serial1);
  Serial1.write('\n');
}

static void dispatch(const String& line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return;
  if (s_handler) s_handler(doc);
}

void loop() {
  while (Serial1.available()) {
    char c = (char)Serial1.read();
    if (c == '\n') { if (s_rx.length()) { dispatch(s_rx); s_rx = ""; } }
    else if (c != '\r') { s_rx += c; if (s_rx.length() > 512) s_rx = ""; }
  }
  uint32_t now = millis();
  if (now - s_last_ping > 5000) {
    s_last_ping = now;
    JsonDocument p; p["type"] = "ping"; send(p);
  }
}

#define QUICK(NAME, TYPE) void NAME() { JsonDocument d; d["type"] = TYPE; send(d); }
QUICK(sendSosResolve, "sos_resolve")
QUICK(sendCallEnded,  "call_ended")
QUICK(sendWake,       "wake")

void sendModeSet(const char* mode) { JsonDocument d; d["type"]="mode_set"; d["mode"]=mode; send(d); }
void sendLanguageSet(const char* lang) { JsonDocument d; d["type"]="language_set"; d["language"]=lang; send(d); }
void sendVolume(int v)             { JsonDocument d; d["type"]="volume_set"; d["volume"]=v; send(d); }
void sendVoice(const char* voice)  { JsonDocument d; d["type"]="voice_set"; d["voice"]=voice; send(d); }
void sendCloud(bool cloud)         { JsonDocument d; d["type"]="cloud_toggle"; d["cloud"]=cloud; send(d); }
void sendPipeline(const char* p)   { JsonDocument d; d["type"]="pipeline_set"; d["pipeline"]=p; send(d); }
void sendTtsEngine(const char* e)  { JsonDocument d; d["type"]="tts_engine_set"; d["engine"]=e; send(d); }
void sendNet(bool online, int rssi, const char* mode) {
  JsonDocument d; d["type"]="net_status"; d["online"]=online; d["rssi"]=rssi; d["mode"]=mode; send(d);
}
void sendCallIncoming(const char* from) { JsonDocument d; d["type"]="call_incoming"; d["from"]=from; send(d); }
void sendCallAnswered(const char* from) { JsonDocument d; d["type"]="call_answered"; d["from"]=from; send(d); }
void sendSmsIncoming(const char* from, const char* text) {
  JsonDocument d; d["type"]="sms_incoming"; d["from"]=from; d["text"]=text; send(d);
}
void sendSosTrigger(const char* note) { JsonDocument d; d["type"]="sos_trigger"; d["note"]=note; send(d); }
void sendTextPrompt(const char* text) { JsonDocument d; d["type"]="text_prompt"; d["text"]=text; send(d); }
void sendMusic(const char* cmd, const char* query) {
  JsonDocument d; d["type"]="music_cmd"; d["cmd"]=cmd;
  if (query) d["query"] = query;
  send(d);
}
} // namespace
