#include "state.h"
#include "config.h"

namespace app_state {
String  device_code   = DEFAULT_DEVICE_CODE;
String  mode          = "ANXIETY";
String  language      = "en";
String  voice         = "female";
int     volume        = 70;
bool    cloud_pref    = true;
String  pipeline      = "auto";
String  tts_engine    = "kokoro";
bool    cloud_ready   = false;
bool    online        = false;
String  backend       = "local";
int     last_reply_ms = 0;
bool    listening     = false;
bool    thinking      = false;
bool    speaking      = false;
bool    sos_active    = false;
bool    in_call       = false;
String  call_from     = "";
String  music_title   = "";
bool    music_playing = false;
MedItem meds[8]       = {};
int     med_count     = 0;

static Listener listeners[8] = {};
static int      listener_count = 0;

void onChange(Listener l) {
  if (listener_count < 8) listeners[listener_count++] = l;
}
void notifyChanged() {
  for (int i = 0; i < listener_count; ++i) if (listeners[i]) listeners[i]();
}
} // namespace
