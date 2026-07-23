#pragma once
#include <Arduino.h>

struct MedItem { int hour; int minute; bool enabled; String label; };

namespace app_state {
extern String  device_code;
extern String  mode;            // ANXIETY / DEPRESSION / ...
extern String  language;        // ISO code: "en" / "es" / "fr" / ...
extern String  voice;           // "female" | "male"
extern int     volume;          // 0..100
extern bool    cloud_pref;      // user preference (legacy: true unless pipeline=offline)
extern String  pipeline;        // "auto" | "online" | "offline"
extern String  tts_engine;      // "kokoro" | "piper" | "cloud" | "espeak"
extern bool    cloud_ready;     // pi reports true when online + cloud key present
extern bool    online;          // last known net status
extern String  backend;         // "cloud" | "local" (last turn)
extern int     last_reply_ms;   // last LLM turn latency in ms (0 if none yet)
extern bool    listening;
extern bool    thinking;
extern bool    speaking;
extern bool    sos_active;
extern bool    in_call;
extern String  call_from;
extern String  music_title;
extern bool    music_playing;
extern MedItem meds[8];
extern int     med_count;

void notifyChanged();  // triggers UI refresh (page-level handlers subscribe)
using Listener = void(*)();
void onChange(Listener l);
}
