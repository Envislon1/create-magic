#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <RTClib.h>
#include <EEPROM.h>
#include <WiFiManager.h>
#include <time.h>
#include "driver/i2s.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <math.h>

// Forward-declared music streaming structs (defined later). Placed up here so
// that the Arduino IDE's auto-generated function prototypes (which reference
// these types) compile correctly.
struct MusicAudioBlock {
  uint8_t* data;
  size_t len;
  bool eof;
};
struct MusicStreamCtx {
  WiFiClient* stream;
  QueueHandle_t queue;
  volatile bool* abortFlag;
  volatile bool done;
  volatile bool cancelled;
  int contentLen;
};
// SD-card MP3 play er has been removed from this build. Music playback is
// handled entirely by internet-radio streaming via the AI [[music:<id>]]
// directive (see src/lib/radio-stations.ts and firmware/app.py).
static inline bool mp3IsActive() { return false; }
static inline void mp3PlayerBegin() {}
static inline void mp3PlayerLoop() {}
static inline void mp3EnterModeAndPlay(const String&) {}

#ifndef BOARD_HAS_PSRAM
#define BOARD_HAS_PSRAM 1
#endif

const char* WM_AP_NAME = "MindBuddy-Setup";   // SSID of the provisioning portal
const char* WM_AP_PASS = "";            // empty = open AP (easier for users)
String server_chat_url       = "";
// STT/TTS run on your local Windows laptop (see local-server/). Set LOCAL_SERVER_BASE to your laptop LAN IP, e.g. "http://192.168.1.42:7860".
String LOCAL_SERVER_BASE     = "http://10.105.28.218:7860";
String server_music_url      = "";
String server_transcribe_url = LOCAL_SERVER_BASE + "/transcribe";
String server_tts_url        = LOCAL_SERVER_BASE + "/tts";

// Re-derive the STT/TTS URLs from the current LOCAL_SERVER_BASE. Call
// this any time LOCAL_SERVER_BASE changes (EEPROM load, captive-portal
// save, webapp sync) so the next /transcribe + /tts request hits the
// new host.
static void rebuildLocalServerUrls() {
  String base = LOCAL_SERVER_BASE;
  while (base.endsWith("/")) base.remove(base.length() - 1);
  server_chat_url       = base + "/chat";
  server_transcribe_url = base + "/transcribe";
  server_tts_url        = base + "/tts";
  server_music_url      = base + "/music";
}

// Direct-to-Supabase bridge. The device no longer routes through the
// lovable.app webapp — it calls PostgREST RPCs on the Supabase project with
// the publishable (anon) key. All write/read logic runs inside SECURITY
// DEFINER SQL functions: device_sync_get, device_sync_post, device_sos_post.
const char* SUPABASE_URL    = "https://cfbvgsypqgwtloxhhswu.supabase.co";
const char* SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmYnZnc3lwcWd3dGxveGhoc3d1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODc0MDMsImV4cCI6MjA5NTQ2MzQwM30.Y1OWtlsApHksHn21hiL1aD_Ip_ez-QHsxAIwQ4wFJH4";

char DEVICE_CODE[16] = "JDHZXS";

char LOCAL_SERVER_BUF[96] = "";   // mirrors LOCAL_SERVER_BASE in EEPROM
unsigned long lastWebappSyncMs = 0;
const unsigned long WEBAPP_SYNC_PERIOD_MS = 10000; // poll DB every 10s so app↔device prefs feel live 

struct Setting { String name; String type; };
void sendSettingToServer(const String& name, const String& type);
void webappPostSOS(const char* note);
void webappSyncPull();
void webappPushState();
void webappResolveSOS();
void webappMarkOTAConsumed();
void webappReportOTAProgress(int pct, const char* status);
// Actual HTTP implementations — invoked only by netTask on core 0.
void _doWebappPostSOS(const char* note);
void _doWebappSyncPull();
void _doWebappPushState();
void _doWebappResolveSOS();
void netTask(void* param);

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ========================================================
// RTC
// ========================================================
RTC_DS3231 rtc;

// ========================================================
// BUTTONS
// ========================================================
#define BTN_PREV   15
// Button arrangement (physical layout, left→right):
//   [TALK]  [PREV]  [NEXT]  [SELECT]
// Physical NEXT button drives the SELECT logic (pin 16) and
// physical SELECT button drives the NEXT logic (pin 7).
// This matches user expectations: the rightmost button confirms.
#define BTN_NEXT   16    // physical "NEXT" button -> NEXT logic (was SELECT pin)
#define BTN_SELECT 7     // physical "SELECT" button -> SELECT logic (was NEXT pin)
#define BTN_TALK   18    // push-to-talk; also acts as BACK in settings UI

// ========================================================
// BUZZER
// ========================================================
#define BUZZER_PIN 17

// ========================================================
// BATTERY MONITOR
// ========================================================
// BAT_ADC_PIN: analog input. Wire your Li-ion +V through a 2:1 resistor
//   divider (e.g. 100k/100k) to this pin so the ADC sees max ~2.1V at 4.2V
//   battery. GPIO 1 = ADC1_CH0 on the ESP32-S3, safe & unused here.
// CHG_PIN: charging-status pin from your charger IC (TP4056 CHRG pad is
//   open-drain, so we use INPUT_PULLUP and treat LOW as "charging").
//   GPIO 2 is free on the S3 and supports digital input with pull-up.
#define BAT_ADC_PIN  1
#define CHG_PIN      2
// Voltage-divider scale: ADC reads half of battery voltage with 100k/100k.
// At 12-bit ADC (0..4095) and 3.3V ref, raw 4095 ≈ 3.3V at pin ≈ 6.6V at
// battery (capped). Typical Li-ion: 3.3V (empty) → 4.2V (full).
static const float BAT_DIVIDER_RATIO = 2.0f;
static const float BAT_EMPTY_V = 2.00f;
static const float BAT_FULL_V  = 3.00f;
static bool   batteryCharging = false;
static int    batteryPercent  = -1; // -1 = unknown / not initialised
static float  batteryVolts    = 0.0f;


volatile bool wifiOk      = false;   // true while WL_CONNECTED
volatile bool cloudBusy   = false;   // true while an HTTP call is in flight
volatile bool systemReady = false;   // set after self-test passes

static inline void cloudBegin() { cloudBusy = true; }
static inline void cloudEnd()   { cloudBusy = false; }


// ========================================================
// I2S MIC (INMP441) on I2S_NUM_0
// ========================================================
#define MIC_SCK 4
#define MIC_SD  6
#define MIC_WS  5
#define SAMPLE_RATE     16000
#define WAKE_WINDOW_MS  3000   // S3+PSRAM: longer wake window, no DRAM pressure
#define PROMPT_MS       15000  // S3+PSRAM: allow long spoken prompts
#define I2S_READ_BUF    512
int16_t i2sBuf[I2S_READ_BUF];

// ========================================================
// I2S SPEAKER (MAX98357A) on I2S_NUM_1
// ========================================================
#ifndef SPK_BCLK
#define SPK_BCLK 11
#endif
#ifndef SPK_LRC
#define SPK_LRC  13
#endif
#ifndef SPK_DIN
#define SPK_DIN  12
#endif
#define SPK_SAMPLE_RATE 16000
// Music comes from HTTP as raw 16 kHz mono PCM. Keep reads and I2S writes
// comfortably larger than tiny TCP chunks, and start playback only after a
// real cushion is queued so weak WiFi does not sound like radio static.
#define MUSIC_HTTP_CHUNK_BYTES 8192
#define MUSIC_I2S_WRITE_BYTES  4096
#define MUSIC_QUEUE_DEPTH      12
#define MUSIC_PREBUFFER_BYTES  65536

// ========================================================
// EEPROM
// ========================================================
#define EEPROM_SIZE   256
#define EE_MAGIC_ADDR 0
#define EE_MAGIC      0xA8   // bumped: layout now also stores LOCAL_SERVER_BASE
#define EE_HOUR       1
#define EE_MIN        2
#define EE_ENABLED    3
#define EE_MODEIDX    4
#define EE_SOUND      5      // 1 = button beeps + medication alarm on, 0 = off
#define EE_VOICE      6      // 0=female, 1=male
#define EE_VOLUME     7      // 0-100 software gain applied to all I2S audio
#define EE_DEVICE_CODE          16
#define EE_DEVICE_CODE_LEN      16
#define EE_LOCAL_SERVER         120
#define EE_LOCAL_SERVER_LEN     96

// ========================================================
// SETTINGS
// ========================================================
Setting settings[] = {
  {"DEPRESSION", "MODE"},
  {"PTSD", "MODE"},
  {"ANXIETY", "MODE"},
  {"ADHD", "MODE"},
  {"BIPOLAR", "MODE"},
  {"SCHIZOPHRENIA", "MODE"},
  {"MEDICATION", "MED"},
  {"VOICE", "VOICE"},
  {"SOUND", "SOUND"},
  {"SOS", "SOS"}
};
const int NUM_SETTINGS = 10;

int settingIndex = 2;
String currentMode = "ANXIETY";

int  medHour = 20;
int  medMinute = 0;
bool medEnabled = true;
int  lastFiredMinute = -1;
bool soundEnabled = true;   // gates button beeps, ringtone, AND medication alarm
uint8_t voicePref = 0;      // 0=Female, 1=Male
uint8_t speakerVolume = 100; // 0-100 software gain for all I2S audio

const char* VOICE_NAMES[] = { "FEMALE", "MALE" };
const char* VOICE_QSTR[]  = { "female", "male" };
const int NUM_VOICES = 2;

bool sosActive = false;
// When the user cancels an SOS locally, the server may still briefly report
// sos_active=true (the resolve POST is async and there is replication lag).
// We record the cancel time and suppress any remote re-trigger for a short
// cooldown so a just-cancelled SOS can never re-arm itself without a fresh
// physical SOS trigger.
unsigned long lastSosCancelMs = 0;
// Widened from 20s -> 45s. The cloud + edge replication can take up to ~30s
// when the network is slow; a shorter cooldown was letting a just-cancelled
// SOS resurrect itself when the next sync pull saw a stale sos_active=true.
const unsigned long SOS_CANCEL_COOLDOWN_MS = 45000;

// Local-first settings: when the user changes a setting on the device we
// push it to the cloud immediately, then ignore any DB-sourced value for
// mode/voice/sound/volume for SETTINGS_GRACE_MS so that a slow sync
// response can never clobber what the user just chose on the hardware.
unsigned long lastLocalSettingsMs = 0;
const unsigned long SETTINGS_GRACE_MS = 8000;
String userInput = "";

volatile bool inSettings = false;
unsigned long lastOledClockMs = 0;

// ========================================================
// CONCURRENCY
// ========================================================

SemaphoreHandle_t spkMutex = NULL;
// Mic task control
volatile bool micTaskBusy   = false;  // true while talking to user
volatile bool stopMusicFlag = false;
volatile bool musicPlaying  = false;
// Pause flag honoured by the music streamer (Select toggles it).
volatile bool musicPausedFlag = false;
// Now-Playing metadata pushed from the server with each [[song:<uuid>]] directive.
String nowPlayingTitle  = "";
String nowPlayingArtist = "";
unsigned long lastNowPlayingDrawMs = 0;
// Newest webapp-driven music command timestamp we've already acted on, so a
// poll loop doesn't replay the same [[music:<id>]] directive over and over.
unsigned long lastMusicAt   = 0;
// Universal interrupt flag — set when the user presses TALK at any moment
// (mid-speech, mid-HTTP, while preparing a reply). Every long-running
// audio / HTTP loop checks this flag and bails immediately so the user
// can interrupt and start a fresh recording without waiting.
volatile bool gInterrupt    = false;

enum NetReqType : uint8_t {
  NR_SYNC_PULL = 1,
  NR_POST_SOS,
  NR_PUSH_STATE,
  NR_RESOLVE_SOS,
};
struct NetReqMsg {
  uint8_t type;
  char    note[64];
};
QueueHandle_t netQueue = NULL;

// ========================================================
// FORWARD DECLS
// ========================================================
void showIdleScreen();
void showModeScreen();
void showReminderScreen();
void showSOSScreen();
void returnToIdle();
void setMedicationTime();
void triggerSOS(bool requireConfirm = true);
bool confirmSOS();
void stopSOS();
// Forward declarations for button state (defined later in file)
extern volatile bool btnPrevFlag;
extern volatile bool btnNextFlag;
extern volatile bool btnSelectFlag;
extern volatile bool btnTalkFlag;
extern unsigned long lastBtnMs;
void saveSettingsEEPROM();
void loadSettingsEEPROM();
void writeEEPROMString(int start, int maxLen, const char* value);
void readEEPROMString(int start, int maxLen, char* out);
void checkForOTAUpdate(const char* url, const char* version);
void initI2SMic();
void initI2SSpeaker();
void playTone(int freq, int ms, float volume = 0.4f);
void speakText(const String& text);
void speakTextStreamed(const String& reply);
String aiCompanionMessage(const char* eventType, const char* fallback);
void playMusic(const String& query);
void showNowPlayingScreen();
void pttCaptureAndSend();
String sendPromptToServer(String prompt);
void handleServerAction(JsonObject obj);
void micTask(void* param);

static String urlEncode(const String& value) {
  String out;
  const char* hex = "0123456789ABCDEF";
  for (size_t i = 0; i < value.length(); ++i) {
    const unsigned char c = (unsigned char)value[i];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_' ||
        c == '.' || c == '~') {
      out += (char)c;
    } else {
      out += '%';
      out += hex[(c >> 4) & 0x0F];
      out += hex[c & 0x0F];
    }
  }
  return out;
}

// ========================================================
// BUZZER
// ========================================================
void beep(int d) {
  if (!soundEnabled) return;
  digitalWrite(BUZZER_PIN, HIGH);
  delay(d);
  digitalWrite(BUZZER_PIN, LOW);
}

// Double beep used as a "setting saved" confirmation.
void savedBeep() {
  if (!soundEnabled) return;
  digitalWrite(BUZZER_PIN, HIGH); delay(80);
  digitalWrite(BUZZER_PIN, LOW);  delay(70);
  digitalWrite(BUZZER_PIN, HIGH); delay(80);
  digitalWrite(BUZZER_PIN, LOW);
}

// ========================================================
// EEPROM
// ========================================================
void writeEEPROMString(int start, int maxLen, const char* value) {
  int i = 0;
  for (; i < maxLen - 1 && value && value[i]; i++) EEPROM.write(start + i, value[i]);
  EEPROM.write(start + i, 0);
  for (i = i + 1; i < maxLen; i++) EEPROM.write(start + i, 0);
}

void readEEPROMString(int start, int maxLen, char* out) {
  for (int i = 0; i < maxLen - 1; i++) {
    uint8_t b = EEPROM.read(start + i);
    out[i] = (b >= 32 && b <= 126) ? (char)b : 0;
    if (out[i] == 0) { out[i] = 0; return; }
  }
  out[maxLen - 1] = 0;
}

void saveSettingsEEPROM() {
  EEPROM.write(EE_MAGIC_ADDR, EE_MAGIC);
  EEPROM.write(EE_HOUR,    (uint8_t)medHour);
  EEPROM.write(EE_MIN,     (uint8_t)medMinute);
  EEPROM.write(EE_ENABLED, medEnabled ? 1 : 0);
  EEPROM.write(EE_MODEIDX, (uint8_t)settingIndex);
  EEPROM.write(EE_SOUND,   soundEnabled ? 1 : 0);
  EEPROM.write(EE_VOICE,   (uint8_t)(voicePref < NUM_VOICES ? voicePref : 0));
  EEPROM.write(EE_VOLUME,  (uint8_t)(speakerVolume > 100 ? 100 : speakerVolume));
  writeEEPROMString(EE_DEVICE_CODE, EE_DEVICE_CODE_LEN, DEVICE_CODE);
  
  // Persist the current LOCAL_SERVER_BASE so the captive portal value
  // survives reboots without needing a re-flash.
  strncpy(LOCAL_SERVER_BUF, LOCAL_SERVER_BASE.c_str(), EE_LOCAL_SERVER_LEN - 1);
  LOCAL_SERVER_BUF[EE_LOCAL_SERVER_LEN - 1] = 0;
  writeEEPROMString(EE_LOCAL_SERVER, EE_LOCAL_SERVER_LEN, LOCAL_SERVER_BUF);
  EEPROM.commit();
  Serial.println(F("[EEPROM] settings saved"));
}

void loadSettingsEEPROM() {
  if (EEPROM.read(EE_MAGIC_ADDR) != EE_MAGIC) {
    Serial.println(F("[EEPROM] no data, using defaults"));
    saveSettingsEEPROM();
    return;
  }
  medHour      = EEPROM.read(EE_HOUR)    % 24;
  medMinute    = EEPROM.read(EE_MIN)     % 60;
  medEnabled   = EEPROM.read(EE_ENABLED) == 1;
  uint8_t idx  = EEPROM.read(EE_MODEIDX);
  if (idx < NUM_SETTINGS) settingIndex = idx;
  if (settings[settingIndex].type == "MODE")
    currentMode = settings[settingIndex].name;
  soundEnabled = EEPROM.read(EE_SOUND) == 1;
  uint8_t v = EEPROM.read(EE_VOICE);
  voicePref = (v < NUM_VOICES) ? v : 0;
  uint8_t vol = EEPROM.read(EE_VOLUME);
  speakerVolume = (vol == 0xFF) ? 100 : (vol > 100 ? 100 : vol);
  readEEPROMString(EE_DEVICE_CODE, EE_DEVICE_CODE_LEN, DEVICE_CODE);
  
  readEEPROMString(EE_LOCAL_SERVER, EE_LOCAL_SERVER_LEN, LOCAL_SERVER_BUF);
  if (strlen(LOCAL_SERVER_BUF) >= 7) {       // "http://" minimum
    LOCAL_SERVER_BASE = String(LOCAL_SERVER_BUF);
  } else {
    strncpy(LOCAL_SERVER_BUF, LOCAL_SERVER_BASE.c_str(), EE_LOCAL_SERVER_LEN - 1);
    LOCAL_SERVER_BUF[EE_LOCAL_SERVER_LEN - 1] = 0;
  }
  rebuildLocalServerUrls();
  if (strlen(DEVICE_CODE) < 4) strcpy(DEVICE_CODE, "JDHZXS");
  Serial.printf("[EEPROM] restored med %02d:%02d en=%d mode=%s sound=%d voice=%s vol=%u code=%s\n",
                medHour, medMinute, medEnabled, currentMode.c_str(), soundEnabled,
                VOICE_NAMES[voicePref], (unsigned)speakerVolume, DEVICE_CODE);
}

// ========================================================
// UI SCREENS
// ========================================================
void showBoot() {
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0); display.println("Mind Buddy");
  display.setTextSize(1);
  display.setCursor(0, 22); display.println("Booting...");
  display.display(); delay(1200);
}
// Sample battery voltage + charging line and update the global state. Cheap
// to call from the idle-screen tick (~1Hz). Averages a few ADC samples for
// stability.
void readBatteryState() {
  uint32_t acc = 0;
  const int N = 8;
  for (int i = 0; i < N; i++) { acc += analogRead(BAT_ADC_PIN); delay(1); }
  float raw = (float)acc / (float)N;          // 0..4095
  // ESP32-S3 default ADC ref ~3.3V; analogReadMilliVolts() would be more
  // accurate, but the simple ratio is fine for a 4-level battery bar.
  float vAtPin = (raw / 4095.0f) * 3.3f;
  batteryVolts = vAtPin * BAT_DIVIDER_RATIO;
  float pct = (batteryVolts - BAT_EMPTY_V) / (BAT_FULL_V - BAT_EMPTY_V) * 100.0f;
  if (pct < 0)   pct = 0;
  if (pct > 100) pct = 100;
  batteryPercent = (int)pct;
  // CHG pin is open-drain on TP4056 → LOW while charging, HIGH (released) idle.
  batteryCharging = (digitalRead(CHG_PIN) == HIGH);
}

// Draw a tiny battery icon at the top-right of the 128x32 OLED. 16x8 px.
static void drawBatteryIcon() {
  if (batteryPercent < 0) return;
  const int x = SCREEN_WIDTH - 16;   // right edge
  const int y = 0;
  // Body 14x7 with a 2x3 nub on the right.
  display.drawRect(x, y, 13, 7, SSD1306_WHITE);
  display.drawRect(x + 13, y + 2, 2, 3, SSD1306_WHITE);
  // Fill: 0..11 px wide based on percent.
  int fill = (batteryPercent * 11) / 100;
  if (fill > 0) display.fillRect(x + 1, y + 1, fill, 5, SSD1306_WHITE);
  // Charging: write "CHG" underneath the battery icon (text size 1 = 6px wide
  // per char -> 18px for "CHG", fits in the 15px battery footprint with a
  // 1px nudge to the left). No "+" dots inside the icon any more.
  if (batteryCharging) {
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(x - 2, y + 9);
    display.print(F("CHG"));
  }
}

void showIdleScreen() {
  readBatteryState();
  DateTime now = rtc.now();
  display.clearDisplay();
  display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print("MODE "); display.print(currentMode);
  drawBatteryIcon();
  display.setCursor(0, 12);
  display.print(now.hour()); display.print(":");
  if (now.minute() < 10) display.print("0");
  display.print(now.minute()); display.print("  Med ");
  if (medEnabled) {
    display.print(medHour); display.print(":");
    if (medMinute < 10) display.print("0");
    display.print(medMinute);
  } else display.print("OFF");
  display.setCursor(0, 24); display.println("Press TALK to speak");
  display.display();
}
void returnToIdle() { inSettings = false; delay(200); showIdleScreen(); lastOledClockMs = millis(); }

// "Now Playing" screen shown while a song streams from Supabase Storage.
// Layout (128x32 OLED):
//   row 0  : "Now Playing"           (state badge: " (PAUSED)" if paused)
//   row 12 : Title (truncated)
//   row 22 : Artist (truncated) + button-nav guide on row 24 if room
// We keep the bottom row as a button guide so the user always knows the
// controls: TALK=Stop  PRV=Vol-  NXT=Vol+  SEL=Play/Pause
void showNowPlayingScreen() {
  display.clearDisplay();
  display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print(F("Now Playing"));
  if (musicPausedFlag) display.print(F(" (PAUSED)"));

  // Title
  display.setCursor(0, 10);
  String t = nowPlayingTitle.length() ? nowPlayingTitle : String("(untitled)");
  if (t.length() > 21) t = t.substring(0, 20) + "~";
  display.print(t);

  // Artist
  display.setCursor(0, 19);
  String a = nowPlayingArtist.length() ? nowPlayingArtist : String("Unknown artist");
  if (a.length() > 21) a = a.substring(0, 20) + "~";
  display.print(a);

  // Button-nav guide (compact, fits 128px at size 1).
  display.setCursor(0, 24);
  // display.print(F("TLK:Stop -:V +:V O:P/P"));
  display.display();
  lastNowPlayingDrawMs = millis();
}

void showModeScreen() {
  display.clearDisplay();
  display.setCursor(0, 0); display.println("SELECT SUPPORT");
  display.setCursor(0, 16); display.print("> ");
  display.println(settings[settingIndex].name);
  display.display();
}
void showReminderScreen() {
  display.clearDisplay();
  display.setCursor(0, 0); display.println("REMINDER");
  display.setCursor(0, 12); display.println("Take Medication");
  display.display();
}
void showSOSScreen() {
  display.clearDisplay();
  display.setCursor(0, 0); display.println("EMERGENCY");
  display.setCursor(0, 16); display.println("Press any button");
  display.display();
}

static void oledStatus(const char* l1, const char* l2 = nullptr,
                       const char* l3 = nullptr, const char* l4 = nullptr) {
  display.clearDisplay();
  display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);  display.println(l1);
  if (l2) { display.setCursor(0, 10); display.println(l2); }
  if (l3) { display.setCursor(0, 20); display.println(l3); }
  if (l4) { display.setCursor(0, 30); display.println(l4); }
  display.display();
}

WiFiManager wm;

// Set by setup() when the user holds the TALK button at power-up.
// connectWiFi() reads it and skips autoConnect() so the captive portal
// opens immediately, WITHOUT wiping the saved Wi-Fi credentials.
volatile bool forcePortalOnBoot = false;

void connectWiFi() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleep(false);
  WiFi.persistent(true);

  oledStatus("Mind Buddy Setup", "Connecting WiFi...");

  WiFiManagerParameter custom_text("<p>Mind Buddy Setup Portal</p>");
  WiFiManagerParameter custom_code("device_code", "Device code", DEVICE_CODE, EE_DEVICE_CODE_LEN - 1);
  
  // Lets the user point the device at a new local STT/TTS server (e.g.
  // when their laptop's LAN IP changes) without re-flashing the firmware.
  WiFiManagerParameter custom_local("local_server", "Local server URL (http://ip:7860)",
                                    LOCAL_SERVER_BUF, EE_LOCAL_SERVER_LEN - 1);
  wm.addParameter(&custom_text);
  wm.addParameter(&custom_code);
  
  wm.addParameter(&custom_local);

  // Called when WiFiManager has fallen back to AP/portal mode.
  wm.setAPCallback([](WiFiManager* mgr) {
    Serial.printf("[WiFi] portal up, AP=%s ip=%s\n",
                  mgr->getConfigPortalSSID().c_str(),
                  WiFi.softAPIP().toString().c_str());
    oledStatus(mgr->getConfigPortalSSID().c_str(),
               "Join AP:",
               WiFi.softAPIP().toString().c_str());
  });
  // Called once the user picks a network in the portal.
  wm.setSaveParamsCallback([&]() {
    strncpy(DEVICE_CODE, custom_code.getValue(), EE_DEVICE_CODE_LEN - 1);
    DEVICE_CODE[EE_DEVICE_CODE_LEN - 1] = 0;
    const char* lv = custom_local.getValue();
    if (lv && strlen(lv) >= 7) {           // "http://" min
      LOCAL_SERVER_BASE = String(lv);
      rebuildLocalServerUrls();
    }
    saveSettingsEEPROM();
    oledStatus("Mind Buddy setup saved", DEVICE_CODE, "Connecting...");
  });

  std::vector<const char *> menu = {"wifi", "param", "info", "sep", "restart", "exit"};
  wm.setMenu(menu);
  wm.setClass("invert");
  wm.setBreakAfterConfig(true);
  wm.setWiFiAutoReconnect(true);
  wm.setConfigPortalTimeout(0);   // no timeout — keep AP alive while user configures
  wm.setConnectTimeout(10);       // short STA attempts before AP fallback
  wm.setConnectRetries(3);
  wm.setDarkMode(true);

  bool ok;
  if (forcePortalOnBoot) {
    // User asked for setup mode by holding TALK at boot. Open the portal
    // directly so they can change WiFi / pairing code / local server URL
    // without us wiping the existing saved credentials first.
    oledStatus(WM_AP_NAME, "Setup mode", "Join AP to config");
    Serial.println(F("[WiFi] starting config portal (TALK-held at boot)"));
    ok = wm.startConfigPortal(WM_AP_NAME, WM_AP_PASS);
    forcePortalOnBoot = false;
  } else {
    ok = wm.autoConnect(WM_AP_NAME, WM_AP_PASS);
  }
  if (!ok) {
    oledStatus("WiFi failed", "Restarting...");
    delay(1500);
    ESP.restart();
  }

  wifiOk = true;
  Serial.printf("[WiFi] connected, ip=%s\n", WiFi.localIP().toString().c_str());
  oledStatus("WiFi connected", WiFi.SSID().c_str(),
             WiFi.localIP().toString().c_str());
  delay(900);
}

void resetWiFiCredentials() {
  oledStatus("Resetting WiFi", "Reopening portal");
  wm.resetSettings();
  delay(500);
  ESP.restart();
}

static unsigned long lastNtpSyncMs = 0;
const long  NTP_TZ_OFFSET_S = 1 * 3600;  // UTC+1
const int   NTP_DST_OFFSET_S = 0;
const unsigned long NTP_REFRESH_PERIOD_MS = 6UL * 60UL * 60UL * 1000UL; // 6h

bool syncRtcFromNtp() {
  if (WiFi.status() != WL_CONNECTED) return false;
  Serial.println(F("[NTP] requesting time..."));
  configTime(NTP_TZ_OFFSET_S, NTP_DST_OFFSET_S,
             "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  struct tm ti;
  // wait up to ~5s for the SNTP daemon to populate the system time.
  for (int i = 0; i < 50; i++) {
    if (getLocalTime(&ti, 100) && ti.tm_year + 1900 >= 2025) break;
    delay(100);
  }
  if (!(ti.tm_year + 1900 >= 2025)) {
    Serial.println(F("[NTP] failed"));
    return false;
  }
  rtc.adjust(DateTime((uint16_t)(ti.tm_year + 1900),
                      (uint8_t)(ti.tm_mon + 1),
                      (uint8_t)ti.tm_mday,
                      (uint8_t)ti.tm_hour,
                      (uint8_t)ti.tm_min,
                      (uint8_t)ti.tm_sec));
  lastNtpSyncMs = millis();
  Serial.printf("[NTP] RTC set to %04d-%02d-%02d %02d:%02d:%02d\n",
                ti.tm_year + 1900, ti.tm_mon + 1, ti.tm_mday,
                ti.tm_hour, ti.tm_min, ti.tm_sec);
  return true;
}

bool rtcLooksWrong() {
  DateTime n = rtc.now();
  uint16_t y = n.year();
  return (y < 2025 || y > 2100);
}

void maybeSyncRtc(bool force) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (force || rtcLooksWrong() ||
      (lastNtpSyncMs && millis() - lastNtpSyncMs > NTP_REFRESH_PERIOD_MS) ||
      lastNtpSyncMs == 0) {
    syncRtcFromNtp();
  }
}

static unsigned long lastOtaPctReportMs = 0;
static int lastOtaPctReported = -1;
void otaProgress(size_t progress, size_t total) {
  int pct = total ? (int)((progress * 100) / total) : 0;
  Serial.printf("[OTA] %d%% (%u/%u)\n", pct, (unsigned)progress, (unsigned)total);
  display.clearDisplay();
  display.setCursor(0, 0); display.println("OTA UPDATE");
  display.setCursor(0, 14); display.print(pct); display.println("% downloading");
  display.display();
  // Throttle: every 5% or every 2s, whichever comes first.
  unsigned long now = millis();
  if (pct != lastOtaPctReported && (pct - lastOtaPctReported >= 5 || pct == 100 || now - lastOtaPctReportMs > 2000)) {
    lastOtaPctReported = pct;
    lastOtaPctReportMs = now;
    webappReportOTAProgress(pct, "downloading");
  }
}

void checkForOTAUpdate(const char* url, const char* version) {
  if (!wifiOk || !url || strlen(url) < 8) return;
  Serial.printf("[OTA] update available version=%s url=%s\n", version ? version : "", url);
  webappReportOTAProgress(0, "downloading");
  webappMarkOTAConsumed(); // prevents an update loop if the flash/reboot succeeds
  oledStatus("OTA UPDATE", "Downloading...", version && strlen(version) ? version : nullptr);
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(60);
  httpUpdate.onProgress(otaProgress);
  lastOtaPctReported = -1; lastOtaPctReportMs = 0;
  t_httpUpdate_return ret = httpUpdate.update(client, String(url));
  if (ret == HTTP_UPDATE_FAILED) {
    Serial.printf("[OTA] failed (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
    oledStatus("OTA FAILED", httpUpdate.getLastErrorString().c_str());
    webappReportOTAProgress(0, "failed");
    delay(1200);
  } else if (ret == HTTP_UPDATE_NO_UPDATES) {
    Serial.println(F("[OTA] no update"));
    webappReportOTAProgress(0, "idle");
  } else if (ret == HTTP_UPDATE_OK) {
    Serial.println(F("[OTA] complete, rebooting"));
    webappReportOTAProgress(100, "installing");
  }
}

// Takes plain Strings (not the Setting struct) so the Arduino IDE's auto-
// generated prototype at the top of the .ino doesn't reference `Setting`
// before its struct declaration is visible.
void sendSettingToServer(const String& name, const String& type) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(server_chat_url);
  http.addHeader("Content-Type", "application/json");
  DynamicJsonDocument doc(512);
  doc["type"]    = "setting_update";
  doc["name"]    = name;
  doc["mode"]    = currentMode;
  if (type == "MED") {
    doc["med_hour"]    = medHour;
    doc["med_minute"]  = medMinute;
    doc["med_enabled"] = medEnabled;
  }
  String body; serializeJson(doc, body);
  http.POST(body);
  http.end();
}

// ========================================================
// MEDICATION SETUP (UI path - unchanged behavior)
// ========================================================
void drawMedSetup(const char* label, int value, bool blinkOn) {
  display.clearDisplay();
  display.setCursor(0, 0); display.println("SET MEDICATION");
  display.setCursor(0, 12);
  display.print(label); display.print(": ");
  if (blinkOn) { if (value < 10) display.print("0"); display.print(value); }
  else display.print("  ");
  display.setCursor(0, 24); display.print("PREV/NEXT  SEL=OK");
  display.display();
}
void waitButtonsReleased() {
  while (digitalRead(BTN_PREV) == LOW ||
         digitalRead(BTN_NEXT) == LOW ||
         digitalRead(BTN_SELECT) == LOW) delay(10);
  delay(60);
}
int editField(const char* label, int value, int minV, int maxV, bool &exitRequest) {
  waitButtonsReleased();
  unsigned long lastBlink = millis();
  bool blinkOn = true;
  drawMedSetup(label, value, blinkOn);
  while (true) {
    if (millis() - lastBlink > 400) {
      blinkOn = !blinkOn;
      drawMedSetup(label, value, blinkOn);
      lastBlink = millis();
    }
    // TALK = back/cancel in any settings UI.
    if (digitalRead(BTN_TALK) == LOW) {
      waitButtonsReleased();
      exitRequest = true;
      return value;
    }
    if (digitalRead(BTN_PREV) == LOW) {
      value--; if (value < minV) value = maxV;
      beep(30); drawMedSetup(label, value, true); delay(150);
    }
    if (digitalRead(BTN_NEXT) == LOW) {
      value++; if (value > maxV) value = minV;
      beep(30); drawMedSetup(label, value, true); delay(150);
    }
    if (digitalRead(BTN_SELECT) == LOW) {
      unsigned long t = millis();
      while (digitalRead(BTN_SELECT) == LOW) {
        if (millis() - t > 2000) {
          medEnabled = !medEnabled;
          beep(150); exitRequest = true;
          waitButtonsReleased(); return value;
        }
      }
      beep(80); waitButtonsReleased(); return value;
    }
    delay(5);
  }
}
void setMedicationTime() {
  inSettings = true;
  bool exitReq = false;
  int h = editField("HOUR", medHour, 0, 23, exitReq);
  medHour = h;
  if (!exitReq) {
    int m = editField("MIN ", medMinute, 0, 59, exitReq);
    medMinute = m;
  }
  if (!exitReq) medEnabled = true;
  saveSettingsEEPROM();
  display.clearDisplay();
  display.setCursor(0, 0); display.println("MED SAVED");
  display.setCursor(0, 12);
  if (medEnabled) {
    display.print(medHour); display.print(":");
    if (medMinute < 10) display.print("0");
    display.print(medMinute);
  } else display.print("DISABLED");
  display.display();
  savedBeep();
}

bool confirmSOS() {
  inSettings = true;
  waitButtonsReleased();
  bool yes = false; // default to NO so accidental SELECT does not fire
  unsigned long start = millis();
  auto draw = [&]() {
    display.clearDisplay();
    display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);  display.println("TRIGGER SOS?");
    display.setCursor(0, 14);
    display.print(yes ? " NO  [YES]" : "[NO]  YES ");
    display.setCursor(0, 24); display.print("PREV/NEXT  SEL=OK");
    display.display();
  };
  draw();
  while (true) {
    if (millis() - start > 10000) { // auto-cancel after 10s
      waitButtonsReleased();
      return false;
    }
    if (digitalRead(BTN_PREV) == LOW || digitalRead(BTN_NEXT) == LOW) {
      yes = !yes; beep(30); draw(); delay(180);
    }
    if (digitalRead(BTN_SELECT) == LOW) {
      beep(60); waitButtonsReleased();
      return yes;
    }
    delay(5);
  }
}

void triggerSOS(bool requireConfirm) {
  if (requireConfirm) {
    if (!confirmSOS()) { returnToIdle(); return; }
  } else {
    inSettings = true;
  }
  sosActive = true;
  showSOSScreen();
  if (requireConfirm) {
    // Only push when SOS originated on the device.
    sendSettingToServer("SOS", "SOS");
    webappPostSOS("SOS triggered from Mind Buddy device");
  } else {
    Serial.println(F("[SOS] remote-triggered from Mind Buddy"));
  }
  waitButtonsReleased();

  // SILENT-VOICE SOS: no AI/TTS narration. The user wants the buzzer +
  // OLED banner to be the unambiguous alarm, with button press dismissing
  // it instantly and locally — without a chatty AI talking over it.
  unsigned long sosStartMs = millis();
  unsigned long lastRemoteCheck = millis();
  while (sosActive) {
    if (soundEnabled) digitalWrite(BUZZER_PIN, HIGH);
    for (int i = 0; i < 30; i++) {
      // LOCAL DISMISS: any button stops the alarm IMMEDIATELY and we exit
      // before any further DB poll runs. The poll only re-armed the alarm
      // because the resolve POST hadn't reached the cloud yet — the
      // SOS_CANCEL_COOLDOWN_MS gate in _doWebappSyncPull is the second
      // line of defence (now widened to 30s, see below).
      if (digitalRead(BTN_PREV) == LOW || digitalRead(BTN_NEXT) == LOW ||
          digitalRead(BTN_SELECT) == LOW) { stopSOS(); return; }
      delay(10);
    }
    digitalWrite(BUZZER_PIN, LOW);
    for (int i = 0; i < 15; i++) {
      if (digitalRead(BTN_PREV) == LOW || digitalRead(BTN_NEXT) == LOW ||
          digitalRead(BTN_SELECT) == LOW) { stopSOS(); return; }
      delay(10);
    }
    // Remote dismiss only — we still pull to honour a caregiver-initiated
    // resolve from the dashboard, but only after a 6s warm-up so the
    // freshly-posted SOS doesn't get clobbered.
    if (millis() - lastRemoteCheck > 2500 && millis() - sosStartMs > 6000) {
      lastRemoteCheck = millis();
      webappSyncPull();
      if (!sosActive) {
        digitalWrite(BUZZER_PIN, LOW);
        display.clearDisplay();
        display.setCursor(0, 0); display.println("SOS RESOLVED");
        display.setCursor(0, 14); display.println("from Mind Buddy");
        display.display();
        delay(900);
        btnPrevFlag = btnNextFlag = btnSelectFlag = false;
        lastBtnMs = millis();
        returnToIdle();
        return;
      }
    }
  }
}
void stopSOS() {
  sosActive = false;
  lastSosCancelMs = millis();
  digitalWrite(BUZZER_PIN, LOW);
  display.clearDisplay();
  display.setCursor(0, 0); display.println("SOS CANCELLED");
  display.display();
  beep(60);
  // Notify webapp so the patient + caregiver dashboards return to idle.
  webappResolveSOS();
  waitButtonsReleased();

  btnPrevFlag = btnNextFlag = btnSelectFlag = false;
  lastBtnMs = millis();
  returnToIdle();
}

bool chooseSoundSetting() {
  inSettings = true;
  waitButtonsReleased();
  bool on = soundEnabled; // default to current value
  unsigned long start = millis();
  auto draw = [&]() {
    display.clearDisplay();
    display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);  display.println("ALARM/BEEP SOUND");
    display.setCursor(0, 14);
    display.print(on ? "[ON]  OFF " : " ON  [OFF]");
    display.setCursor(0, 24); display.print("TALK=back  SEL=OK");
    display.display();
  };
  draw();
  while (true) {
    if (millis() - start > 15000) {
      waitButtonsReleased();
      return false;
    }
    // TALK acts as "back" in any settings UI.
    if (digitalRead(BTN_TALK) == LOW) {
      waitButtonsReleased();
      return false;
    }
    if (digitalRead(BTN_PREV) == LOW || digitalRead(BTN_NEXT) == LOW) {
      on = !on; beep(30); draw(); delay(180);
      start = millis();
    }
    if (digitalRead(BTN_SELECT) == LOW) {
      waitButtonsReleased();
      soundEnabled = on;
      saveSettingsEEPROM();
      beep(60);
      return true;
    }
    delay(5);
  }
}

// Cycle through available TTS voices on the device. PREV/NEXT change the
// preview, SELECT saves, TALK exits without saving.
bool chooseVoiceSetting() {
  inSettings = true;
  waitButtonsReleased();
  uint8_t picked = voicePref < NUM_VOICES ? voicePref : 0;
  unsigned long start = millis();
  auto draw = [&]() {
    display.clearDisplay();
    display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);  display.println("VOICE");
    display.setCursor(0, 14);
    display.print("> "); display.println(VOICE_NAMES[picked]);
    display.setCursor(0, 24); display.print("TALK=back  SEL=OK");
    display.display();
  };
  draw();
  while (true) {
    if (millis() - start > 20000) { waitButtonsReleased(); return false; }
    if (digitalRead(BTN_TALK) == LOW) { waitButtonsReleased(); return false; }
    if (digitalRead(BTN_PREV) == LOW) {
      picked = (picked == 0) ? NUM_VOICES - 1 : picked - 1;
      beep(30); draw(); delay(180); start = millis();
    }
    if (digitalRead(BTN_NEXT) == LOW) {
      picked = (picked + 1) % NUM_VOICES;
      beep(30); draw(); delay(180); start = millis();
    }
    if (digitalRead(BTN_SELECT) == LOW) {
      waitButtonsReleased();
      voicePref = picked;
      saveSettingsEEPROM();
      savedBeep();
      return true;
    }
    delay(5);
  }
}

void handleSelection() {
  Setting s = settings[settingIndex];
  if (s.type == "MODE") {
    currentMode = s.name;
    saveSettingsEEPROM();
    showModeScreen();
    sendSettingToServer(s.name, s.type);
    webappPushState();
    savedBeep();
    returnToIdle();
  } else if (s.type == "SOS") {
    triggerSOS();
  } else if (s.type == "MED") {
    setMedicationTime();
    sendSettingToServer(s.name, s.type);
    webappPushState();
    returnToIdle();
  } else if (s.type == "SOUND") {
    chooseSoundSetting();
    returnToIdle();
  } else if (s.type == "VOICE") {
    chooseVoiceSetting();
    returnToIdle();
  }
}

// debounce state
unsigned long lastBtnMs = 0;

volatile bool btnPrevFlag   = false;
volatile bool btnNextFlag   = false;
volatile bool btnSelectFlag = false;
volatile bool btnTalkFlag   = false;
volatile unsigned long btnPrevIsrMs   = 0;
volatile unsigned long btnNextIsrMs   = 0;
volatile unsigned long btnSelectIsrMs = 0;
volatile unsigned long btnTalkIsrMs   = 0;

void IRAM_ATTR isrBtnPrev() {
  unsigned long n = millis();
  if (n - btnPrevIsrMs < 40) return;
  btnPrevIsrMs = n;
  btnPrevFlag = true;
}
void IRAM_ATTR isrBtnNext() {
  unsigned long n = millis();
  if (n - btnNextIsrMs < 40) return;
  btnNextIsrMs = n;
  btnNextFlag = true;
}
void IRAM_ATTR isrBtnSelect() {
  unsigned long n = millis();
  if (n - btnSelectIsrMs < 40) return;
  btnSelectIsrMs = n;
  btnSelectFlag = true;
}
void IRAM_ATTR isrBtnTalk() {
  unsigned long n = millis();
  if (n - btnTalkIsrMs < 40) return;
  btnTalkIsrMs = n;
  btnTalkFlag = true;
}

static bool confirmHeld(int pin, int ms) {
  unsigned long t = millis();
  while (millis() - t < (unsigned long)ms) {
    if (digitalRead(pin) != LOW) return false;
    delay(2);
  }
  return true;
}

void handleButtons() {
  // Only treat TALK as an interrupt if the press is actually sustained.
  // A bouncy/transient ISR edge would otherwise silently kill the AI's
  // spoken reply mid-stream (speakText() bails when gInterrupt is set).
  // Always clear the flag after handling so it can't re-trigger forever.
  if (btnTalkFlag) {
    bool real = (digitalRead(BTN_TALK) == LOW) && confirmHeld(BTN_TALK, 60);
    if (real && (cloudBusy || micTaskBusy || musicPlaying)) {
      gInterrupt    = true;
      stopMusicFlag = true;
    }
    if (!real) btnTalkFlag = false;
  }
  // While a song is playing the buttons act as a media remote:
  //   TALK    -> stop playback and return to Idle
  //   PREV    -> volume DOWN (5%)
  //   NEXT    -> volume UP   (5%)
  //   SELECT  -> play/pause toggle
  if (musicPlaying && !mp3IsActive()) {
    // TALK = stop + idle
    if (btnTalkFlag || digitalRead(BTN_TALK) == LOW) {
      btnTalkFlag = false;
      stopMusicFlag  = true;
      musicPausedFlag = false;
      beep(40);
      waitButtonsReleased();
      // Drop the user back to the idle screen as soon as the streamer exits.
      returnToIdle();
      return;
    }
    // PREV = volume down
    if (btnPrevFlag || digitalRead(BTN_PREV) == LOW) {
      btnPrevFlag = false;
      if (speakerVolume >= 5) speakerVolume -= 5; else speakerVolume = 0;
      saveSettingsEEPROM();
      Serial.printf("[MUSIC] vol- -> %u\n", (unsigned)speakerVolume);
      showNowPlayingScreen();
      waitButtonsReleased();
      btnPrevFlag = btnNextFlag = btnSelectFlag = false;
      return;
    }
    // NEXT = volume up
    if (btnNextFlag || digitalRead(BTN_NEXT) == LOW) {
      btnNextFlag = false;
      if (speakerVolume <= 95) speakerVolume += 5; else speakerVolume = 100;
      saveSettingsEEPROM();
      Serial.printf("[MUSIC] vol+ -> %u\n", (unsigned)speakerVolume);
      showNowPlayingScreen();
      waitButtonsReleased();
      btnPrevFlag = btnNextFlag = btnSelectFlag = false;
      return;
    }
    // SELECT = play / pause toggle
    if (btnSelectFlag || digitalRead(BTN_SELECT) == LOW) {
      btnSelectFlag = false;
      musicPausedFlag = !musicPausedFlag;
      beep(30);
      Serial.printf("[MUSIC] %s\n", musicPausedFlag ? "paused" : "resumed");
      showNowPlayingScreen();
      waitButtonsReleased();
      btnPrevFlag = btnNextFlag = btnSelectFlag = false;
      return;
    }
  }

  if (millis() - lastBtnMs < 250) return;       // stronger debounce

  if (btnPrevFlag || digitalRead(BTN_PREV) == LOW) {
    btnPrevFlag = false;
    if (!confirmHeld(BTN_PREV, 25)) { lastBtnMs = millis(); return; }
    beep(30);
    settingIndex--; if (settingIndex < 0) settingIndex = NUM_SETTINGS - 1;
    inSettings = true;
    showModeScreen();
    waitButtonsReleased();   // <-- one press = one cycle
    btnPrevFlag = btnNextFlag = btnSelectFlag = false;
    lastBtnMs = millis();
  }
  else if (btnNextFlag || digitalRead(BTN_NEXT) == LOW) {
    btnNextFlag = false;
    if (!confirmHeld(BTN_NEXT, 25)) { lastBtnMs = millis(); return; }
    beep(30);
    settingIndex++; if (settingIndex > NUM_SETTINGS - 1) settingIndex = 0;
    inSettings = true;
    showModeScreen();
    waitButtonsReleased();
    btnPrevFlag = btnNextFlag = btnSelectFlag = false;
    lastBtnMs = millis();
  }
  else if (btnSelectFlag || digitalRead(BTN_SELECT) == LOW) {
    btnSelectFlag = false;
    // Require a real press (≥40ms of sustained LOW) — kills noise-triggered
    // ISR flags so the device can never spontaneously enter SOS.
    if (!confirmHeld(BTN_SELECT, 40)) { lastBtnMs = millis(); return; }
    if (cloudBusy) { lastBtnMs = millis(); return; }
    unsigned long t = millis();
    bool longPress = false;
    while (digitalRead(BTN_SELECT) == LOW) {
      if (millis() - t > 2000) { longPress = true; break; }
      delay(5);
    }
    if (longPress) { waitButtonsReleased(); triggerSOS(); }
    else { beep(80); handleSelection(); }
    btnPrevFlag = btnNextFlag = btnSelectFlag = false;
    lastBtnMs = millis();
  }
}

void checkMedication() {
  if (!medEnabled) return;
  DateTime now = rtc.now();
  if (now.hour() == medHour && now.minute() == medMinute &&
      lastFiredMinute != now.minute()) {
    lastFiredMinute = now.minute();
    showReminderScreen();
    // Silent alarm — buzzer + OLED banner only, no AI voice (the talking
    // reminder was making the buzzer hard to dismiss and felt intrusive).
    unsigned long start = millis();
    while (millis() - start < 60000) {
      // ANY button press dismisses immediately and we exit straight away —
      // do not poll the database first, so the alarm cannot "resurrect"
      // because the cloud hasn't yet seen our resolve.
      if (digitalRead(BTN_PREV) == LOW || digitalRead(BTN_NEXT) == LOW ||
          digitalRead(BTN_SELECT) == LOW || digitalRead(BTN_TALK) == LOW) {
        digitalWrite(BUZZER_PIN, LOW);
        waitButtonsReleased();
        returnToIdle();
        return;
      }
      if (soundEnabled) {
        digitalWrite(BUZZER_PIN, HIGH); delay(200);
        digitalWrite(BUZZER_PIN, LOW);  delay(200);
      } else {
        delay(400);
      }
    }
    digitalWrite(BUZZER_PIN, LOW);
    waitButtonsReleased();
    returnToIdle();
  }
  if (now.minute() != medMinute) lastFiredMinute = -1;
}

// ========================================================
// I2S MIC
// ========================================================
void initI2SMic() {
  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins = {
    .bck_io_num = MIC_SCK,
    .ws_io_num  = MIC_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num  = MIC_SD
  };
  i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
  i2s_zero_dma_buffer(I2S_NUM_0);
}

// ========================================================
// I2S SPEAKER
// ========================================================
void initI2SSpeaker() {
  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = SPK_SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL2,
    .dma_buf_count = 24,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins = {
    .bck_io_num   = SPK_BCLK,
    .ws_io_num    = SPK_LRC,
    .data_out_num = SPK_DIN,
    .data_in_num  = I2S_PIN_NO_CHANGE
  };
  i2s_driver_install(I2S_NUM_1, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_1, &pins);
  i2s_zero_dma_buffer(I2S_NUM_1);
  i2s_start(I2S_NUM_1);
  Serial.println(F("[SPK] MAX98357A initialised on I2S_NUM_1"));
}

void playTone(int freq, int ms, float volume) {
  const int sr = SPK_SAMPLE_RATE;
  const int total = (sr * ms) / 1000;
  const int chunk = 256;
  int16_t buf[chunk];
  float phase = 0.0f;
  float step  = 2.0f * (float)M_PI * (float)freq / (float)sr;
  // Apply user-selected speaker volume on top of the per-call volume param.
  float effectiveVol = volume * ((float)speakerVolume / 100.0f);
  int amp = (int)(32767.0f * effectiveVol);
  i2s_zero_dma_buffer(I2S_NUM_1);
  int written = 0;
  while (written < total) {
    int n = min(chunk, total - written);
    for (int i = 0; i < n; i++) {
      float env = min(1.0f, min((float)(written + i) / 160.0f, (float)(total - written - i) / 160.0f));
      buf[i] = (int16_t)(sinf(phase) * amp * env);
      phase += step;
      if (phase > 2.0f * (float)M_PI) phase -= 2.0f * (float)M_PI;
    }
    size_t bw = 0;
    i2s_write(I2S_NUM_1, buf, n * sizeof(int16_t), &bw, portMAX_DELAY);
    written += n;
  }
  memset(buf, 0, sizeof(buf));
  size_t bw = 0;
  // Push enough trailing silence to flush the DMA queue before zeroing,
  // otherwise the tail of the tone is chopped (same bug that clipped TTS).
  for (int i = 0; i < 4; i++) {
    i2s_write(I2S_NUM_1, buf, sizeof(buf), &bw, portMAX_DELAY);
  }
  delay(60);
  i2s_zero_dma_buffer(I2S_NUM_1);
}

static void showSpeakingScreen(const String& text); // forward decl
static void streamPcmFromHttp(HTTPClient& http, volatile bool* abortFlag,
                              const String* speakingText) {
  WiFiClient* stream = http.getStreamPtr();
  stream->setNoDelay(true);

  int contentLen = http.getSize();          // -1 if chunked
  size_t cap = contentLen > 0 ? (size_t)contentLen + 4096 : 131072;
  if (cap > 2 * 1024 * 1024) cap = 2 * 1024 * 1024; // 2MB hard cap
  uint8_t* audio = (uint8_t*)ps_malloc(cap);
  if (!audio) {
    Serial.println(F("[SPK] ps_malloc failed"));
    return;
  }
  size_t got = 0;
  unsigned long lastData = millis();
  const size_t CHUNK = 4096;

  while (http.connected()) {
    if (gInterrupt) break;
    if (abortFlag && *abortFlag) break;
    if (contentLen > 0 && got >= (size_t)contentLen) break;
    size_t avail = stream->available();
    if (avail) {
      if (got + CHUNK > cap) {
        size_t newCap = cap * 2;
        if (newCap > 2 * 1024 * 1024) newCap = 2 * 1024 * 1024;
        if (newCap <= got) break;
        uint8_t* bigger = (uint8_t*)ps_realloc(audio, newCap);
        if (!bigger) break;
        audio = bigger; cap = newCap;
      }
      size_t toRead = avail > (cap - got) ? (cap - got) : avail;
      if (toRead > CHUNK) toRead = CHUNK;
      int n = stream->readBytes(audio + got, toRead);
      if (n <= 0) break;
      got += n;
      lastData = millis();
    } else {
      if (millis() - lastData > 10000) break;
      delay(2);
      if (!stream->connected() && !stream->available()) break;
    }
  }

  // If the user already interrupted, skip playback entirely.
  if (gInterrupt) {
    free(audio);
    i2s_zero_dma_buffer(I2S_NUM_1);
    return;
  }

  // Strip a WAV header if the server sent one.
  uint8_t* pcm = audio;
  size_t pcmLen = got;
  if (pcmLen > 44 && pcm[0]=='R' && pcm[1]=='I' && pcm[2]=='F' && pcm[3]=='F') {
    pcm += 44; pcmLen -= 44;
  }

  Serial.printf("[SPK] buffered %u bytes (~%us audio)\n",
                (unsigned)pcmLen, (unsigned)(pcmLen / (SPK_SAMPLE_RATE * 2)));

  if (speakingText) showSpeakingScreen(*speakingText);

  const size_t WRITE_CHUNK = 4096;
  size_t played = 0;
  while (played < pcmLen) {
    if (gInterrupt) break;
    if (abortFlag && *abortFlag) break;
    // Honour pause: spin (still checking abort/interrupt) without writing
    // samples. Volume changes from button presses are picked up here.
    if (musicPausedFlag) {
      delay(50);
      continue;
    }
    size_t n = (pcmLen - played) > WRITE_CHUNK ? WRITE_CHUNK : (pcmLen - played);
    // Apply user-selected speaker volume as a software gain. Skip the
    // multiply when at 100% so full-volume playback is bit-exact.
    if (speakerVolume < 100) {
      int16_t* p = (int16_t*)(pcm + played);
      size_t cnt = n / 2;
      uint16_t s = speakerVolume;
      for (size_t i = 0; i < cnt; i++) {
        p[i] = (int16_t)(((int32_t)p[i] * s) / 100);
      }
    }
    size_t bw = 0;
    i2s_write(I2S_NUM_1, pcm + played, n, &bw, portMAX_DELAY);
    played += bw ? bw : n;
  }
  free(audio);

  // CRITICAL: i2s_write returns once samples are queued into the DMA
  // buffer, NOT once they have actually been played through the speaker.
  // Calling i2s_zero_dma_buffer() right away wipes the still-pending tail
  // and chops the last word of every chunk ("buddy" -> "bud"). Push a few
  // frames of true silence so playback drains naturally, then wait long
  // enough for the DMA queue to empty before zeroing.
  if (!gInterrupt && !(abortFlag && *abortFlag)) {
    static int16_t silence[1024];   // ~64ms of zeros at 16kHz mono
    size_t bw = 0;
    // ~480ms of trailing silence — comfortably larger than the I2S DMA
    // queue (8 buffers x 256 frames = ~128ms) so the real audio finishes.
    for (int i = 0; i < 8; i++) {
      i2s_write(I2S_NUM_1, silence, sizeof(silence), &bw, portMAX_DELAY);
    }
    // Block until the DMA queue has actually drained.
    delay(120);
  }
  i2s_zero_dma_buffer(I2S_NUM_1);
}

// (MusicAudioBlock and MusicStreamCtx are defined near the top of this file.)


static inline bool musicAbortRequested(MusicStreamCtx* ctx) {
  return gInterrupt || ctx->cancelled || (ctx->abortFlag && *(ctx->abortFlag));
}

static void musicSendEof(MusicStreamCtx* ctx) {
  MusicAudioBlock eof = { nullptr, 0, true };
  while (!ctx->cancelled && xQueueSend(ctx->queue, &eof, pdMS_TO_TICKS(100)) != pdTRUE) {
    if (musicAbortRequested(ctx)) break;
  }
}

static bool musicQueueBlock(MusicStreamCtx* ctx, MusicAudioBlock* block) {
  while (!musicAbortRequested(ctx)) {
    if (xQueueSend(ctx->queue, block, pdMS_TO_TICKS(100)) == pdTRUE) return true;
  }
  if (block->data) free(block->data);
  block->data = nullptr;
  block->len = 0;
  return false;
}

static void musicStreamProducerTask(void* param) {
  MusicStreamCtx* ctx = (MusicStreamCtx*)param;
  WiFiClient* stream = ctx->stream;
  stream->setNoDelay(true);
  stream->setTimeout(1500);

  int remaining = ctx->contentLen;
  unsigned long lastData = millis();
  while (!musicAbortRequested(ctx)) {
    if (remaining == 0) break;
    size_t target = MUSIC_HTTP_CHUNK_BYTES;
    if (remaining > 0 && target > (size_t)remaining) target = (size_t)remaining;

    uint8_t* data = (uint8_t*)ps_malloc(target);
    if (!data) data = (uint8_t*)malloc(target);
    if (!data) break;

    size_t filled = 0;
    unsigned long blockStart = millis();
    while (filled < target && !musicAbortRequested(ctx)) {
      size_t avail = stream->available();
      if (!avail) {
        if (!stream->connected()) break;
        if (millis() - lastData > 15000) break;
        if (filled > 0 && millis() - blockStart > 40) break; // coalesce tiny TCP chunks
        vTaskDelay(pdMS_TO_TICKS(2));
        continue;
      }

      size_t toRead = target - filled;
      if (toRead > avail) toRead = avail;
      int n = stream->readBytes(data + filled, toRead);
      if (n <= 0) break;
      filled += (size_t)n;
      lastData = millis();
      if (remaining > 0) {
        remaining -= n;
        if (remaining == 0) break;
      }
    }

    if (!filled) {
      free(data);
      break;
    }
    MusicAudioBlock block = { data, filled, false };
    if (!musicQueueBlock(ctx, &block)) break;
  }

  ctx->done = true;
  musicSendEof(ctx);
  vTaskDelete(NULL);
}

static void drainMusicQueue(QueueHandle_t queue) {
  MusicAudioBlock block;
  while (xQueueReceive(queue, &block, 0) == pdTRUE) {
    if (block.data) free(block.data);
  }
}

static void writeMusicBlockToI2S(MusicAudioBlock* block, volatile bool* abortFlag) {
  size_t played = 0;
  while (played < block->len) {
    if (gInterrupt || (abortFlag && *abortFlag)) break;
    if (musicPausedFlag) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    size_t n = block->len - played;
    if (n > MUSIC_I2S_WRITE_BYTES) n = MUSIC_I2S_WRITE_BYTES;
    n &= ~((size_t)1); // int16 sample alignment
    if (!n) break;

    if (speakerVolume < 100) {
      int16_t* p = (int16_t*)(block->data + played);
      size_t cnt = n / 2;
      uint16_t s = speakerVolume;
      for (size_t i = 0; i < cnt; i++) {
        p[i] = (int16_t)(((int32_t)p[i] * s) / 100);
      }
    }

    size_t bw = 0;
    esp_err_t err = i2s_write(I2S_NUM_1, block->data + played, n, &bw, pdMS_TO_TICKS(500));
    if (err != ESP_OK) {
      Serial.printf("[MUSIC] i2s_write err=%d\n", (int)err);
      break;
    }
    played += bw ? bw : n;
  }
}

static void streamMusicPcmFromHttp(HTTPClient& http, volatile bool* abortFlag) {
  WiFiClient* stream = http.getStreamPtr();
  QueueHandle_t queue = xQueueCreate(MUSIC_QUEUE_DEPTH, sizeof(MusicAudioBlock));
  if (!queue) {
    Serial.println(F("[MUSIC] queue alloc failed, using simple playback"));
    streamPcmFromHttp(http, abortFlag, NULL);
    return;
  }

  MusicStreamCtx ctx = { stream, queue, abortFlag, false, false, http.getSize() };
  TaskHandle_t rxTask = NULL;
  BaseType_t ok = xTaskCreatePinnedToCore(
    musicStreamProducerTask,
    "musicRx",
    8192,
    &ctx,
    4,
    &rxTask,
    0
  );
  if (ok != pdPASS) {
    vQueueDelete(queue);
    Serial.println(F("[MUSIC] rx task failed, using simple playback"));
    streamPcmFromHttp(http, abortFlag, NULL);
    return;
  }

  const UBaseType_t prebufferBlocks = max((UBaseType_t)2, (UBaseType_t)(MUSIC_PREBUFFER_BYTES / MUSIC_HTTP_CHUNK_BYTES));
  Serial.println(F("[MUSIC] prebuffering stream"));
  while (!gInterrupt && !(abortFlag && *abortFlag) && !ctx.done && uxQueueMessagesWaiting(queue) < prebufferBlocks) {
    vTaskDelay(pdMS_TO_TICKS(20));
  }

  Serial.printf("[MUSIC] start buffered blocks=%u\n", (unsigned)uxQueueMessagesWaiting(queue));
  i2s_zero_dma_buffer(I2S_NUM_1);

  MusicAudioBlock block;
  while (!gInterrupt && !(abortFlag && *abortFlag)) {
    if (xQueueReceive(queue, &block, pdMS_TO_TICKS(250)) != pdTRUE) {
      if (ctx.done) break;
      Serial.println(F("[MUSIC] buffer underrun"));
      continue;
    }
    if (block.eof) break;
    if (block.data && block.len) writeMusicBlockToI2S(&block, abortFlag);
    if (block.data) free(block.data);
  }

  ctx.cancelled = true;
  drainMusicQueue(queue);
  unsigned long waitStart = millis();
  while (!ctx.done && millis() - waitStart < 5000) {
    drainMusicQueue(queue);
    vTaskDelay(pdMS_TO_TICKS(20));
  }
  if (!ctx.done && rxTask) {
    Serial.println(F("[MUSIC] stopping stalled rx task"));
    vTaskDelete(rxTask);
    ctx.done = true;
  }
  drainMusicQueue(queue);
  vQueueDelete(queue);

  if (!gInterrupt && !(abortFlag && *abortFlag)) {
    static int16_t silence[1024];
    size_t bw = 0;
    for (int i = 0; i < 8; i++) {
      i2s_write(I2S_NUM_1, silence, sizeof(silence), &bw, portMAX_DELAY);
    }
    delay(120);
  }
  i2s_zero_dma_buffer(I2S_NUM_1);
}

// Show a "Speaking..." screen while audio is playing through the speaker.
static void showSpeakingScreen(const String& text) {
  display.clearDisplay();
  display.setCursor(0, 0);  display.println("SPEAKING...");
  display.setCursor(0, 14); display.println("Mind Buddy is talking");
  // Show first ~40 chars of the reply as a hint
  String hint = text;
  if (hint.length() > 80) hint = hint.substring(0, 77) + "...";
  display.setCursor(0, 34); display.println(hint);
  display.display();
}

static void showPreparingVoiceScreen() {
  display.clearDisplay();
  display.setCursor(0, 0);  display.println("PREPARING VOICE");
  display.setCursor(0, 14); display.println("Just a moment...");
  display.display();
}

void speakText(const String& text) {
  if (!text.length()) return;
  if (gInterrupt) return;                            // user already pressed TALK — skip
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[SPK] no wifi, fallback tone"));
    playTone(880, 120); return;
  }
  if (xSemaphoreTake(spkMutex, pdMS_TO_TICKS(8000)) != pdTRUE) return;

  bool wasInSettings = inSettings;
  inSettings = true;

  showPreparingVoiceScreen();

  cloudBegin();
  HTTPClient http;
  http.setTimeout(30000);
  // Append the user's chosen voice as a query param so the server can pick
  // a male/female/neutral/warm timbre per device.
  String url = server_tts_url + String("?voice=") + VOICE_QSTR[voicePref < NUM_VOICES ? voicePref : 0];
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Connection", "keep-alive");
  DynamicJsonDocument doc(2048);
  doc["text"]  = text;
  doc["mode"]  = currentMode;
  doc["voice"] = VOICE_QSTR[voicePref < NUM_VOICES ? voicePref : 0];
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  if (gInterrupt) {
    http.end(); cloudEnd();
    inSettings = wasInSettings;
    xSemaphoreGive(spkMutex);
    return;
  }
  if (code != 200) {
    Serial.printf("[SPK] tts http %d, fallback tone\n", code);
    http.end();
    cloudEnd();
    playTone(660, 80); delay(60); playTone(880, 120);
    inSettings = wasInSettings;
    if (!wasInSettings) returnToIdle();
    xSemaphoreGive(spkMutex);
    return;
  }

  cloudEnd();
  streamPcmFromHttp(http, NULL, &text);
  http.end();
  Serial.println(F("[SPK] done"));
  inSettings = wasInSettings;
  if (!wasInSettings && !gInterrupt) returnToIdle();
  xSemaphoreGive(spkMutex);
}

// Sentence-streamed TTS: split a long reply into ~2-3 sentence chunks and
// speak each one. The first chunk starts playing as soon as its TTS audio
// arrives, while later chunks queue up — so the user hears the reply
// begin within ~1s instead of waiting for the full response, AND long
// replies are never truncated because we always speak the remaining tail.
void speakTextStreamed(const String& reply) {
  if (!reply.length()) return;
  // Larger chunks = fewer HTTP round-trips for long conversations, while
  // still keeping first-audio latency low (the first chunk closes on the
  // earliest sentence boundary >=60 chars).
  const size_t MAX_CHUNK = 280;
  const size_t MIN_BOUNDARY = 60;
  String buf = "";
  buf.reserve(MAX_CHUNK + 32);
  const char* s = reply.c_str();
  size_t n = reply.length();
  for (size_t i = 0; i < n; i++) {
    if (gInterrupt) return;              // user pressed TALK mid-speech
    char c = s[i];
    buf += c;
    bool boundary = (c == '.' || c == '!' || c == '?' || c == '\n');
    bool nextIsSpace = (i + 1 >= n) || s[i + 1] == ' ' || s[i + 1] == '\n';
    if ((boundary && nextIsSpace && buf.length() >= MIN_BOUNDARY) || buf.length() >= MAX_CHUNK) {
      String chunk = buf;
      chunk.trim();
      if (chunk.length()) speakText(chunk);
      if (gInterrupt) return;
      buf = "";
    }
  }
  if (gInterrupt) return;
  // ALWAYS speak the remaining tail — this is what guarantees the AI
  // finishes its thought on long conversations.
  String tail = buf;
  tail.trim();
  if (tail.length()) speakText(tail);
  // Item 9: short "done" chirp at the end of every completed AI response so
  // the user has an audible cue that the assistant has finished and they
  // may speak again. Suppressed when the user interrupted mid-speech or
  // when alarm/beep sounds are disabled.
  if (!gInterrupt && soundEnabled) {
    playTone(1800, 80, 0.35f);
    delay(40);
    playTone(1400, 60, 0.35f);
  }
}

// Ask the AI cloud for a short, situation-appropriate spoken line and
// return it. Used so SOS / medication events trigger a real AI-generated
// companion voice instead of a fixed canned string. Falls back to the
// provided text on any network/JSON error so the user always hears
// something kind.
String aiCompanionMessage(const char* eventType, const char* fallback) {
  if (!wifiOk) return String(fallback);
  cloudBegin();
  HTTPClient http;
  http.setTimeout(15000);
  http.begin(server_chat_url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Session-Id", DEVICE_CODE);
  DynamicJsonDocument doc(384);
  doc["type"]       = eventType;          // "sos" or "medication_reminder"
  doc["mode"]       = currentMode;
  doc["session_id"] = DEVICE_CODE;
  doc["message"]    = "";                  // backend will craft the prompt
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  String reply = fallback;
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument res(2048);
    if (!deserializeJson(res, payload)) {
      String r = res["response"] | "";
      r.trim();
      if (r.length()) reply = r;
    }
  } else {
    Serial.printf("[AI] companion(%s) http %d\n", eventType, code);
  }
  http.end();
  cloudEnd();
  return reply;
}



void playMusic(const String& query) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (xSemaphoreTake(spkMutex, pdMS_TO_TICKS(2000)) != pdTRUE) return;

  HTTPClient http;
  http.setTimeout(20000);
  String url = server_music_url + "?q=" + urlEncode(query);
  http.begin(url);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[MUSIC] http %d\n", code);
    http.end();
    xSemaphoreGive(spkMutex);
    return;
  }
  musicPlaying  = true;
  stopMusicFlag = false;
  musicPausedFlag = false;
  Serial.printf("[MUSIC] playing: %s\n", query.c_str());
  showNowPlayingScreen();
  streamMusicPcmFromHttp(http, &stopMusicFlag);
  http.end();
  musicPlaying = false;
  // Clear Now-Playing metadata so a stale title doesn't reappear later.
  nowPlayingTitle  = "";
  nowPlayingArtist = "";
  musicPausedFlag  = false;
  Serial.println(F("[MUSIC] done"));
  xSemaphoreGive(spkMutex);
}

// ========================================================
// MIC RECORDING + WAKE
// ========================================================
size_t recordPCM(int16_t* buf, size_t maxSamples) {
  size_t total = 0;
  while (total < maxSamples) {
    size_t toRead = min((size_t)I2S_READ_BUF, maxSamples - total) * sizeof(int16_t);
    size_t bytesRead = 0;
    i2s_read(I2S_NUM_0, (void*)i2sBuf, toRead, &bytesRead, portMAX_DELAY);
    size_t samples = bytesRead / sizeof(int16_t);
    memcpy(buf + total, i2sBuf, samples * sizeof(int16_t));
    total += samples;
  }
  return total;
}

float rmsEnergy(int16_t* buf, size_t n) {
  double sum = 0;
  for (size_t i = 0; i < n; i++) { double v = buf[i]; sum += v*v; }
  return (float)sqrt(sum / n);
}

// Lightweight transcription-only POST. No LLM, no TTS.
String transcribeAudio(int16_t* buf, size_t samples) {
  if (WiFi.status() != WL_CONNECTED) return "";
  cloudBegin();
  HTTPClient http;
  http.setTimeout(10000);
  http.begin(server_transcribe_url);
  http.addHeader("Content-Type", "application/octet-stream");
  http.addHeader("Connection", "keep-alive");
  // Scope accent-learning to this device so the server's Accent Layer
  // can apply per-user corrections it has learned over time.
  http.addHeader("X-Session-Id", String(DEVICE_CODE));
  int code = http.POST((uint8_t*)buf, samples * sizeof(int16_t));
  String text = "";
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument res(1024);
    if (!deserializeJson(res, payload)) {
      text = res["text"] | "";
    }
  } else {
    Serial.printf("[STT] http %d\n", code);
  }
  http.end();
  cloudEnd();
  return text;
}

// ========================================================
// AI SERVER (full chat)
// ========================================================
String sendPromptToServer(String prompt) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[AI] no wifi");
    return "";
  }
  cloudBegin();
  HTTPClient http;
  http.setTimeout(15000);
  http.begin(server_chat_url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Connection", "keep-alive");
  DynamicJsonDocument doc(2048);
  doc["type"]    = "user_message";
  doc["message"] = prompt;
  doc["mode"]    = currentMode;
  doc["med_hour"] = medHour;
  doc["med_minute"] = medMinute;
  doc["med_enabled"] = medEnabled;

  doc["session_id"] = String(DEVICE_CODE);
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  String reply = "";
  String actionType = "";
  DynamicJsonDocument res(4096);
  bool haveJson = false;
  if (code > 0) {
    String payload = http.getString();
    Serial.print("[AI raw] "); Serial.println(payload);
    if (!deserializeJson(res, payload)) {
      reply = res["response"] | "";
      haveJson = true;
    } else {
      Serial.print("[AI] bad json: "); Serial.println(payload);
    }
  } else {
    Serial.printf("[AI] http %d\n", code);
  }
  http.end();
  cloudEnd();

  Serial.print("[YOU] "); Serial.println(prompt);
  Serial.print("[AI ] "); Serial.println(reply.length() ? reply : "(no reply)");

  // Act on server-side action BEFORE speaking, so the spoken
  // reply can confirm the change.
  if (haveJson && res.containsKey("action")) {
    JsonObject act = res["action"].as<JsonObject>();
    handleServerAction(act);
  }

  // Always speak SOMETHING back to the user — silence is confusing and
  // unprofessional. If the server didn't return text, fall back to a
  // warm randomized prompt so the conversation can continue.
  if (!reply.length()) {
    static const char* gapFillers[] = {
    "Network issue detected. Please try again.",
    "Looks like a network problem. Your message didn’t come through.",
    "There was a network interruption. Could you resend it?",
    "Network error on my side — I didn’t receive that properly.",
    "Connection seems unstable. Please try again."
};
    const int gn = sizeof(gapFillers)/sizeof(gapFillers[0]);
    reply = String(gapFillers[random(0, gn)]);
  }
  // Clear any stray interrupt that may have been raised by a bouncy TALK
  // button while we were busy with STT / chat HTTP. Without this, the
  // reply gets printed to serial but speakText() silently bails on its
  // first line — the exact "no audio for some replies" symptom.
  gInterrupt  = false;
  btnTalkFlag = false;
  speakTextStreamed(reply);
  return reply;
}

// Handle structured actions coming back from the server.
// Supported:
//   set_medication: { hour, minute, enabled }
//   play_music    : { query }
//   stop_music    : {}
void handleServerAction(JsonObject obj) {
  if (obj.isNull()) return;
  String t = obj["type"] | "";
  
  if (t == "set_medication") {
    int h = obj["hour"] | medHour;
    int m = obj["minute"] | medMinute;
    
    // FIX: Check if the field exists before reading it
    bool en = true;
    if (obj.containsKey("enabled")) {
      en = obj["enabled"].as<bool>();
    } else {
      en = medEnabled; // keep existing if not specified
    }
    
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      medHour    = h;
      medMinute  = m;
      medEnabled = en;
      saveSettingsEEPROM();
      Serial.printf("[ACTION] medication set %02d:%02d en=%d\n", h, m, en);
      webappPushState();
      showIdleScreen();
    }
  } else if (t == "play_music") {
    String q     = obj["query"]  | "";
    String title = obj["title"]  | "";
    String artist= obj["artist"] | "";
    // Prefer explicit title for the search query (the server's catalogue
    // resolves title → signed URL on /music). Fall back to query field.
    if (!q.length() && title.length()) q = title;
    if (title.length())  nowPlayingTitle  = title;
    if (artist.length()) nowPlayingArtist = artist;
    Serial.printf("[ACTION] play_music q='%s' title='%s' artist='%s'\n",
                  q.c_str(), title.c_str(), artist.c_str());
    if (q.length()) {
      // Run music in the background so the AI can still be interrupted
      // by buttons (handled in handleButtons via stopMusicFlag).
      playMusic(q);
    }
  } else if (t == "play_radio") {
    // Curated internet-radio stream. The server maps `radio:<station>` to
    // a real public stream (lofi, calm, jazz, classical, news, ...).
    String station = obj["station"] | "lofi";
    playMusic(String("radio:") + station);
  } else if (t == "tell_joke") {
    String joke = obj["joke"] | "";
    if (joke.length()) speakTextStreamed(joke);
  } else if (t == "stop_music") {
    stopMusicFlag = true;
  } else if (t == "set_mode") {
    String newMode = obj["mode"] | "";
    newMode.toUpperCase();
    newMode.trim();
    if (newMode.length()) {
      bool matched = false;
      for (int i = 0; i < NUM_SETTINGS; i++) {
        if (settings[i].type == "MODE" && settings[i].name == newMode) {
          settingIndex = i;
          currentMode  = settings[i].name;
          matched = true;
          break;
        }
      }
      if (matched) {
        saveSettingsEEPROM();
        webappPushState();
        showIdleScreen();
        Serial.printf("[ACTION] mode set -> %s\n", currentMode.c_str());
      } else {
        Serial.printf("[ACTION] set_mode ignored: '%s' not recognized\n", newMode.c_str());
      }
    }
  }
}

// ========================================================
// Audio buffer allocator
// ========================================================
static int16_t* allocAudioBuffer(size_t fullSamples,
                                 size_t fallbackSamples,
                                 size_t* outSamples,
                                 const char* tag) {
  int16_t* p = NULL;
#if CONFIG_SPIRAM_SUPPORT || defined(BOARD_HAS_PSRAM)
  if (psramFound()) {
    p = (int16_t*) ps_malloc(fullSamples * sizeof(int16_t));
    if (p) {
      *outSamples = fullSamples;
      Serial.printf("[AUDIO] %s: PSRAM %u samples\n", tag, (unsigned)fullSamples);
      return p;
    }
  }
#endif
  p = (int16_t*) malloc(fallbackSamples * sizeof(int16_t));
  if (p) {
    *outSamples = fallbackSamples;
    Serial.printf("[AUDIO] %s: DRAM %u samples [shrunk]\n", tag, (unsigned)fallbackSamples);
    return p;
  }
  Serial.printf("[AUDIO] %s: alloc FAILED\n", tag);
  *outSamples = 0;
  return NULL;
}

void pttCaptureAndSend() {
  static int16_t* prompt = NULL;
  static size_t   cap    = 0;
  if (!prompt) {
    prompt = allocAudioBuffer(
      (size_t)SAMPLE_RATE * PROMPT_MS / 1000,
      (size_t)SAMPLE_RATE * (PROMPT_MS / 2) / 1000,
      &cap, "prompt");
    if (!prompt) return;
  }

  if (!wifiOk) {
    display.clearDisplay();
    display.setCursor(0, 0);  display.println("NO WIFI");
    display.setCursor(0, 14); display.println("Waiting for signal");
    display.display();
    delay(900);
    returnToIdle();
    return;
  }

  auto drawListening = [&](int secsLeft) {
    display.clearDisplay();
    display.setCursor(0, 0);  display.println("LISTENING...");
    display.setCursor(0, 12);
    display.print("Time left: ");
    if (secsLeft < 10) display.print(" ");
    display.print(secsLeft); display.println("s");
    display.setCursor(0, 24); display.println("TALK again to stop");
    display.display();
  };
  drawListening(PROMPT_MS / 1000);
  beep(40);

  size_t total = 0;
  // Item 7: ignore any recording shorter than 3 seconds. Whisper hallucinates
  // polite stock phrases ("Thank you", "Hello.") on sub-second clips, and a
  // 3s floor lets a real spoken command always make it through.
  const size_t minSamples = (size_t)SAMPLE_RATE * 3;
  unsigned long startMs = millis();
  // Drain any stale samples sitting in the DMA buffer before we start.
  size_t junk = 0;
  i2s_read(I2S_NUM_0, (void*)i2sBuf, sizeof(i2sBuf), &junk, 0);

  unsigned long lastTick = 0;
  // SINGLE-PRESS RECORDING (fast, ISR-driven):
  //   The starting press already set btnTalkFlag; we clear it once on
  //   entry. From here on, the very next FALLING edge on BTN_TALK
  //   stops the recording immediately — no hold, no release-confirm,
  //   no debounce wait. ISR-level debounce (40 ms) is enough.
  btnTalkFlag = false;
  while (total < cap) {
    if (btnTalkFlag) { btnTalkFlag = false; break; }   // fast stop on next press
    size_t toRead = min((size_t)I2S_READ_BUF, cap - total) * sizeof(int16_t);
    size_t bytesRead = 0;
    i2s_read(I2S_NUM_0, (void*)i2sBuf, toRead, &bytesRead, pdMS_TO_TICKS(50));
    size_t samples = bytesRead / sizeof(int16_t);
    if (samples) {
      memcpy(prompt + total, i2sBuf, samples * sizeof(int16_t));
      total += samples;
    }
    unsigned long elapsed = millis() - startMs;
    if (elapsed > (unsigned long)PROMPT_MS) break;
    if (millis() - lastTick > 250) {
      lastTick = millis();
      long left = (long)PROMPT_MS - (long)elapsed;
      int secsLeft = left > 0 ? (int)((left + 999) / 1000) : 0;
      drawListening(secsLeft);
    }
  }
  // tiny tail so the last syllable isn't clipped
  unsigned long tail = millis();
  while (millis() - tail < 250 && total < cap) {
    size_t toRead = min((size_t)I2S_READ_BUF, cap - total) * sizeof(int16_t);
    size_t bytesRead = 0;
    i2s_read(I2S_NUM_0, (void*)i2sBuf, toRead, &bytesRead, pdMS_TO_TICKS(50));
    size_t samples = bytesRead / sizeof(int16_t);
    if (samples) {
      memcpy(prompt + total, i2sBuf, samples * sizeof(int16_t));
      total += samples;
    }
  }
  beep(20);

  // The second TALK press that ended this recording almost certainly also
  // raced into micTask (which sets gInterrupt=true whenever btnTalkFlag fires
  // while micTaskBusy is true). If we don't clear it now, the very next
  // speakText()/speakTextStreamed() call will see gInterrupt=true on its
  // first line and silently return — the user hears nothing even though
  // STT + chat both succeeded. Clear the stale interrupt before we proceed
  // so the AI's spoken reply actually reaches the speaker.
  gInterrupt = false;
  btnTalkFlag = false;

  if (total < minSamples) {
    Serial.printf("[PTT] too short (%lums), ignoring\n",
                  (unsigned long)(total * 1000UL / SAMPLE_RATE));
    // Tiny "too short" chirp so the user knows the press registered but the
    // recording was discarded. Skipped when sound is off.
    if (soundEnabled) { playTone(500, 70); }
    returnToIdle();
    return;
  }

  // Auto-gain: scale so the loudest sample is ~70% of full-scale.
  // Hard-multiplying everything by 6x was clipping into white-noise
  // hash, which is exactly what makes Whisper-tiny hallucinate polite
  // phrases like "Thank you very much." Instead, find the actual peak
  // and scale to leave headroom — never amplify by more than 4x.
  int32_t peak = 1;
  for (size_t i = 0; i < total; i++) {
    int32_t a = prompt[i] < 0 ? -(int32_t)prompt[i] : (int32_t)prompt[i];
    if (a > peak) peak = a;
  }
  // target peak = 22937 (~0.7 * 32767)
  int32_t gainQ8 = (22937 * 256) / peak;          // fixed-point x256
  if (gainQ8 < 256) gainQ8 = 256;                 // never attenuate
  if (gainQ8 > 1024) gainQ8 = 1024;               // cap at 4x
  for (size_t i = 0; i < total; i++) {
    int32_t v = ((int32_t)prompt[i] * gainQ8) >> 8;
    if (v >  32767) v =  32767;
    if (v < -32768) v = -32768;
    prompt[i] = (int16_t)v;
  }

  // Energy gate — reject true silence / room hum.
  float energy = rmsEnergy(prompt, total);
  if (energy < 350.0f) {
    Serial.printf("[PTT] silence (rms=%.0f), ignoring\n", energy);
    returnToIdle();
    return;
  }

  display.clearDisplay();
  display.setCursor(0, 0);  display.println("PROCESSING...");
  display.setCursor(0, 14); display.println("Just a moment");
  display.display();

  String userText = transcribeAudio(prompt, total);
  if (!userText.length()) {
    Serial.println(F("[STT] empty transcript"));
    static const char* misses[] = {
      "Could you repeat that for me?",
      "I missed that — please say it again.",
      "Hmm, the sound didn't come through clearly. Try once more.",
      "One more time please, I want to make sure I get it right.",
      "Let's try that again — go ahead whenever you're ready.",
      "I didn't quite get it. Please say it again.",
    };
    const int n = sizeof(misses)/sizeof(misses[0]);
    speakText(misses[random(0, n)]);
    returnToIdle();
    return;
  }
  Serial.print("[YOU] "); Serial.println(userText);
  sendPromptToServer(userText);
  returnToIdle();
}

void micTask(void* param) {
  (void)param;
  // Keep one small scratch buffer to drain DMA when idle.
  int16_t drain[I2S_READ_BUF];
  for (;;) {
    // If TALK is pressed while we're busy speaking / processing / playing
    // music, raise the universal interrupt flag so every long-running audio
    // and HTTP loop bails immediately. ISR-driven so it's near-instant.
    if (btnTalkFlag &&
        (sosActive || musicPlaying || micTaskBusy || cloudBusy)) {
      // Confirm the press is actually sustained — otherwise a stray ISR
      // edge from a bouncy TALK button silently kills speech.
      bool real = (digitalRead(BTN_TALK) == LOW) && confirmHeld(BTN_TALK, 60);
      if (real && !sosActive) {            // SOS still needs explicit acknowledgement
        btnTalkFlag = false;
        gInterrupt   = true;
        stopMusicFlag = true;            // also kills any music stream
      } else if (!real) {
        btnTalkFlag = false;
      }
      vTaskDelay(pdMS_TO_TICKS(30));
      continue;
    }
    if (sosActive || musicPlaying || micTaskBusy) {
      vTaskDelay(pdMS_TO_TICKS(30));
      continue;
    }
    // While the user is navigating settings the TALK button is a "back"
    // control owned by the settings UI loops. Never start a recording from
    // here in that case — that would steal the press and drop the user out
    // of the menu they were editing.
    if (inSettings) {
      // TALK must ALWAYS respond. If we're in a settings UI, force-exit
      // the menu and start a recording on this same press instead of
      // silently eating it.
      if (btnTalkFlag) {
        inSettings   = false;
        btnTalkFlag  = false;
        gInterrupt   = false;
        micTaskBusy  = true;
        pttCaptureAndSend();
        micTaskBusy  = false;
        gInterrupt   = false;
        btnTalkFlag  = false;
      } else {
        vTaskDelay(pdMS_TO_TICKS(30));
      }
      continue;
    }
    if (btnTalkFlag) {
      // ISR-confirmed press: react immediately, no confirm-held delay.
      btnTalkFlag = false;
      gInterrupt  = false;
      micTaskBusy = true;
      pttCaptureAndSend();
      micTaskBusy = false;
      gInterrupt  = false;                // recording cycle complete
      // Clear any stray edge captured during capture so the next
      // press is genuinely "the next press".
      btnTalkFlag = false;
      continue;
    }
    // Always-listening: drain DMA so the mic stays active in the background.
    size_t br = 0;
    i2s_read(I2S_NUM_0, (void*)drain, sizeof(drain), &br, pdMS_TO_TICKS(20));
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// ========================================================
// SETUP
// ========================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n=== Mind Buddy (ESP32-S3) ==="));

  EEPROM.begin(EEPROM_SIZE);

  pinMode(BTN_PREV,   INPUT_PULLUP);
  pinMode(BTN_NEXT,   INPUT_PULLUP);
  pinMode(BTN_SELECT, INPUT_PULLUP);
  pinMode(BTN_TALK,   INPUT_PULLUP);   // push-to-talk button
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Battery monitor pins. ADC = analog input, CHG = digital input with
  // pull-up (TP4056 CHRG is open-drain → LOW while charging).
  pinMode(BAT_ADC_PIN, INPUT);
  pinMode(CHG_PIN, INPUT);
  analogReadResolution(12);


#ifdef RGB_BUILTIN
  pinMode(RGB_BUILTIN, OUTPUT);
  digitalWrite(RGB_BUILTIN, LOW);
  neopixelWrite(RGB_BUILTIN, 0, 0, 0); // addressable variant
#endif
  pinMode(48, OUTPUT); digitalWrite(48, LOW);

  // Latch every falling edge on the nav buttons so a short tap is never
  // missed while loop() is blocked in a cloud HTTP call.
  attachInterrupt(digitalPinToInterrupt(BTN_PREV),   isrBtnPrev,   FALLING);
  attachInterrupt(digitalPinToInterrupt(BTN_NEXT),   isrBtnNext,   FALLING);
  attachInterrupt(digitalPinToInterrupt(BTN_SELECT), isrBtnSelect, FALLING);
  attachInterrupt(digitalPinToInterrupt(BTN_TALK),   isrBtnTalk,   FALLING);

  Wire.begin(20, 21);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED FAILED");
    while (1) { delay(200); }
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.display();

  rtc.begin();
  loadSettingsEEPROM();
  showBoot();

  // Boot-time TALK hold: if the user is holding TALK at power-up
  // (debounced ~300ms), open the captive portal so they can re-configure
  // Wi-Fi / pairing code / local-server URL. Saved Wi-Fi credentials are
  // PRESERVED — the portal just lets the user change them if they want.
  {
    unsigned long t0 = millis();
    bool held = digitalRead(BTN_TALK) == LOW;
    while (held && millis() - t0 < 300) {
      if (digitalRead(BTN_TALK) != LOW) { held = false; break; }
      delay(10);
    }
    if (held) {
      forcePortalOnBoot = true;
      oledStatus("SETUP MODE", "Opening WiFi portal", WM_AP_NAME);
      Serial.println(F("[BOOT] TALK held -> opening config portal (creds kept)"));
      delay(400);
    }
  }

  // WiFi is required. Blocks (with BLUE-blink LED) until connected.
  connectWiFi();

  // Bring the RTC into sync with NTP at boot.
  maybeSyncRtc(true);

  initI2SMic();
  initI2SSpeaker();

  spkMutex = xSemaphoreCreateMutex();

  // Speaker self-test — speak a friendly welcome so the user hears the
  // device come online and knows the speaker + cloud TTS both work.
  Serial.println(F("[SPK] welcome"));
  display.clearDisplay();
  display.setCursor(0, 0);  display.println("MIND BUDDY");
  display.setCursor(0, 14); display.println("Welcoming...");
  display.display();
  systemReady = true;
  speakText("Welcome to Mind Buddy");
  delay(1000);
  showIdleScreen();

  // Mic / network work on core 0 so loop() (core 1) stays snappy.
  xTaskCreatePinnedToCore(
    micTask,        // function
    "micTask",      // name
    8192,           // stack
    NULL,           // params
    1,              // priority
    NULL,           // handle
    0               // core
  );


  netQueue = xQueueCreate(8, sizeof(NetReqMsg));
  xTaskCreatePinnedToCore(
    netTask,        // function
    "netTask",      // name
    8192,           // stack
    NULL,           // params
    3,              // priority: keep cloud/audio streaming ahead of low-priority mic drain
    NULL,           // handle
    0               // core
  );

  // SD-card MP3 player removed; music is now streamed from internet radio.
  mp3PlayerBegin();  // no-op stub

  Serial.println(F("[READY] type a message + <enter>, or press TALK once to record."));
}

// ========================================================
// LOOP (core 1) - only UI / buttons / serial / RTC
// ========================================================
void loop() {
  // ----- WiFi watchdog -----
  // If WiFi drops AFTER boot, mark wifiOk false. Every cloud-touching
  // path is gated on wifiOk so no speech / no chat / no sync is attempted.
  // We also try to silently re-associate in the background.
  bool live = (WiFi.status() == WL_CONNECTED);
  if (live != wifiOk) {
    wifiOk = live;
    if (!live) Serial.println(F("[WiFi] DISCONNECTED"));
    else       Serial.println(F("[WiFi] reconnected"));
  }
  if (!wifiOk) {
    WiFi.reconnect();
  }

  handleButtons();
  checkMedication();
  mp3PlayerLoop();  // no-op stub (MP3 player removed)

  // Periodic RTC-driven OLED refresh so the time on the idle screen
  // stays in sync. Suspended while the user is in any settings/menu
  // flow so we never overwrite menu/edit screens.
  if (!inSettings && !sosActive && !micTaskBusy && !musicPlaying && !cloudBusy &&
      millis() - lastOledClockMs > 1000) {
    lastOledClockMs = millis();
    showIdleScreen();
  }
  // While music streams, refresh the Now Playing screen ~ every 2s so the
  // PAUSED indicator and any title/artist updates from the server stay current.
  if (musicPlaying && !sosActive && !micTaskBusy &&
      millis() - lastNowPlayingDrawMs > 2000) {
    showNowPlayingScreen();
  }

  // Periodic webapp sync now runs in netTask on core 0 — see netTask().

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      userInput.trim();
      if (userInput.length() > 0) {
        if (!wifiOk) {
          Serial.println(F("[CHAT] no wifi, ignored"));
        } else {
          sendPromptToServer(userInput);
        }
        userInput = "";
        returnToIdle();
      }
    } else {
      userInput += c;
    }
  }
  delay(5);   // tiny yield, keeps WDT happy without slowing buttons
}

// ========================================================
// SUPABASE DIRECT BRIDGE (replaces the lovable.app webapp routes)
// All endpoints below POST JSON to /rest/v1/rpc/<fn> on the Supabase
// project, authenticated by the publishable anon key + pairing code.
// ========================================================
static void _supabaseRpcBeginCommon(HTTPClient& http, const char* fn, uint16_t timeoutMs) {
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/" + fn;
  Serial.printf("[SUPA] rpc %s code=%s\n", url.c_str(), DEVICE_CODE);
  http.setTimeout(timeoutMs);
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
}

void _doWebappPostSOS(const char* note) {
  if (!wifiOk) return;
  if (String(DEVICE_CODE) == "PASTE_PAIRING_CODE") return;
  cloudBegin();
  HTTPClient http;
  _supabaseRpcBeginCommon(http, "device_sos_post", 6000);
  DynamicJsonDocument doc(256);
  doc["_code"] = DEVICE_CODE;
  JsonObject p = doc.createNestedObject("_payload");
  if (note && *note) p["note"] = note;
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[SUPA] sos -> %d\n", code);
  http.end();
  cloudEnd();
}

void _doWebappPushState() {
  if (!wifiOk) return;
  if (String(DEVICE_CODE) == "PASTE_PAIRING_CODE") return;
  lastLocalSettingsMs = millis();
  cloudBegin();
  HTTPClient http;
  _supabaseRpcBeginCommon(http, "device_sync_post", 6000);
  DynamicJsonDocument doc(512);
  doc["_code"] = DEVICE_CODE;
  JsonObject p = doc.createNestedObject("_payload");
  p["mode"] = currentMode;
  JsonObject med = p.createNestedObject("med");
  med["hour"]    = medHour;
  med["minute"]  = medMinute;
  med["enabled"] = medEnabled;
  p["sound_enabled"]   = soundEnabled;
  p["preferred_voice"] = VOICE_QSTR[voicePref < NUM_VOICES ? voicePref : 0];
  p["speaker_volume"]  = (int)speakerVolume;
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[SUPA] push -> %d\n", code);
  http.end();
  cloudEnd();
}

void _doWebappResolveSOS() {
  if (!wifiOk) return;
  if (String(DEVICE_CODE) == "PASTE_PAIRING_CODE") return;
  cloudBegin();
  HTTPClient http;
  _supabaseRpcBeginCommon(http, "device_sync_post", 6000);
  DynamicJsonDocument doc(192);
  doc["_code"] = DEVICE_CODE;
  JsonObject p = doc.createNestedObject("_payload");
  p["sos_resolve"] = true;
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[SUPA] sos-resolve -> %d\n", code);
  http.end();
  cloudEnd();
}

void webappReportOTAProgress(int pct, const char* status) {
  if (!wifiOk) return;
  if (String(DEVICE_CODE) == "PASTE_PAIRING_CODE") return;
  cloudBegin();
  HTTPClient http;
  _supabaseRpcBeginCommon(http, "device_sync_post", 4000);
  DynamicJsonDocument doc(256);
  doc["_code"] = DEVICE_CODE;
  JsonObject p = doc.createNestedObject("_payload");
  p["ota_progress"] = pct;
  if (status && strlen(status)) p["ota_status"] = status;
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[SUPA] ota-progress %d%% (%s) -> %d\n", pct, status ? status : "", code);
  http.end();
  cloudEnd();
}

void webappMarkOTAConsumed() {
  if (!wifiOk) return;
  if (String(DEVICE_CODE) == "PASTE_PAIRING_CODE") return;
  cloudBegin();
  HTTPClient http;
  _supabaseRpcBeginCommon(http, "device_sync_post", 6000);
  DynamicJsonDocument doc(192);
  doc["_code"] = DEVICE_CODE;
  JsonObject p = doc.createNestedObject("_payload");
  p["ota_consumed"] = true;
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[SUPA] ota-consumed -> %d\n", code);
  http.end();
  cloudEnd();
}

void _doWebappSyncPull() {
  if (String(DEVICE_CODE) == "PASTE_PAIRING_CODE") return;
  if (!wifiOk) return;
  cloudBegin();
  HTTPClient http;
  _supabaseRpcBeginCommon(http, "device_sync_get", 5000);
  // PostgREST RPC requires POST; pass single jsonb arg "params" containing _code.
  DynamicJsonDocument req(128);
  req["_code"] = DEVICE_CODE;
  String reqBody; serializeJson(req, reqBody);
  int code = http.POST(reqBody);
  bool remoteSos = false;
  String otaUrl = "";
  String otaVersion = "";
  String pendingMusic = "";
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument res(1536);
    if (!deserializeJson(res, payload)) {
      String newMode = res["mode"] | currentMode;
      bool changed = false;
      bool settingsGrace =
          (lastLocalSettingsMs != 0) &&
          ((millis() - lastLocalSettingsMs) < SETTINGS_GRACE_MS);
      if (!settingsGrace) {
        if (newMode.length() && newMode != currentMode) {
          currentMode = newMode;
          for (int i = 0; i < NUM_SETTINGS; i++) {
            if (settings[i].type == "MODE" && settings[i].name == currentMode) {
              settingIndex = i; break;
            }
          }
          changed = true;
        }
        if (!res["med"].isNull()) {
          int newMedHour = res["med"]["hour"] | medHour;
          int newMedMinute = res["med"]["minute"] | medMinute;
          bool newMedEnabled = res["med"]["enabled"] | medEnabled;
          if (newMedHour >= 0 && newMedHour < 24 && newMedMinute >= 0 && newMedMinute < 60) {
            if (newMedHour != medHour || newMedMinute != medMinute || newMedEnabled != medEnabled) {
              medHour = newMedHour;
              medMinute = newMedMinute;
              medEnabled = newMedEnabled;
              changed = true;
            }
          }
        }
      }
      remoteSos = res["sos_active"] | false;
      if (!settingsGrace) {
        if (res.containsKey("sound_enabled")) {
          bool se = res["sound_enabled"] | soundEnabled;
          if (se != soundEnabled) { soundEnabled = se; changed = true; }
        }
        if (res.containsKey("preferred_voice")) {
          String pv = res["preferred_voice"] | "";
          pv.toLowerCase();
          uint8_t newVoice = voicePref;
          if (pv == "male") newVoice = 1;
          else if (pv == "female") newVoice = 0;
          if (newVoice != voicePref) { voicePref = newVoice; changed = true; }
        }
        if (res.containsKey("speaker_volume")) {
          int sv = res["speaker_volume"] | (int)speakerVolume;
          if (sv < 0) sv = 0; if (sv > 100) sv = 100;
          if ((uint8_t)sv != speakerVolume) {
            speakerVolume = (uint8_t)sv; changed = true;
          }
        }
      }
      if (!res["ota"].isNull()) {
        otaUrl = res["ota"]["url"] | "";
        otaVersion = res["ota"]["version"] | "";
      }
      if (!res["music"].isNull()) {
        String mq = res["music"]["query"] | "";
        unsigned long mAt = res["music"]["at"] | 0UL;
        String mTitle  = res["music"]["title"]  | "";
        String mArtist = res["music"]["artist"] | "";
        if (mq.length() && mAt != 0UL && mAt != lastMusicAt) {
          lastMusicAt = mAt;
          pendingMusic = mq;
          nowPlayingTitle  = mTitle;
          nowPlayingArtist = mArtist;
          Serial.printf("[MUSIC] new directive: title='%s' artist='%s' url=%s\n",
                        nowPlayingTitle.c_str(), nowPlayingArtist.c_str(), mq.c_str());
        }
      }
      if (changed) {
        saveSettingsEEPROM();
        if (!sosActive && !micTaskBusy && !musicPlaying) showIdleScreen();
        Serial.printf("[SUPA] sync mode=%s med=%02d:%02d en=%d\n",
                      currentMode.c_str(), medHour, medMinute, medEnabled);
      }
    }
  } else {
    String err = http.getString();
    Serial.printf("[SUPA] sync http %d\n", code);
    if (err.length()) {
      Serial.printf("[SUPA] sync body: %s\n", err.c_str());
    }
  }
  http.end();
  cloudEnd();

  bool cancelCooldown =
      lastSosCancelMs != 0 && (millis() - lastSosCancelMs) < SOS_CANCEL_COOLDOWN_MS;
  if (remoteSos && !sosActive) {
    if (!cancelCooldown) triggerSOS(false);
  } else if (!remoteSos && sosActive) {
    sosActive = false;
    digitalWrite(BUZZER_PIN, LOW);
  }
  if (otaUrl.length() > 8 && !sosActive && !micTaskBusy && !musicPlaying) {
    checkForOTAUpdate(otaUrl.c_str(), otaVersion.c_str());
  }
  if (pendingMusic.length() && !sosActive && !micTaskBusy) {
    if (pendingMusic == "stop") {
      stopMusicFlag = true;
    } else if (!musicPlaying) {
      playMusic(pendingMusic);
    }
  }
}


static inline void netEnqueue(uint8_t type, const char* note = nullptr) {
  if (!netQueue) return;
  NetReqMsg m;
  m.type = type;
  m.note[0] = 0;
  if (note) {
    strncpy(m.note, note, sizeof(m.note) - 1);
    m.note[sizeof(m.note) - 1] = 0;
  }
  // Drop oldest if full so the UI never blocks.
  if (xQueueSend(netQueue, &m, 0) != pdTRUE) {
    NetReqMsg discard;
    xQueueReceive(netQueue, &discard, 0);
    xQueueSend(netQueue, &m, 0);
  }
}

void webappPostSOS(const char* note) { netEnqueue(NR_POST_SOS, note); }
void webappPushState()               { netEnqueue(NR_PUSH_STATE); }
void webappResolveSOS()              { netEnqueue(NR_RESOLVE_SOS); }
void webappSyncPull()                { netEnqueue(NR_SYNC_PULL); }

void netTask(void* /*param*/) {
  unsigned long lastSync = 0;
  NetReqMsg msg;
  for (;;) {
    // Drain any pending one-shot requests first.
    while (netQueue && xQueueReceive(netQueue, &msg, 0) == pdTRUE) {
      switch (msg.type) {
        case NR_POST_SOS:    _doWebappPostSOS(msg.note); break;
        case NR_PUSH_STATE:  _doWebappPushState();       break;
        case NR_RESOLVE_SOS: _doWebappResolveSOS();      break;
        case NR_SYNC_PULL:   _doWebappSyncPull(); lastSync = millis(); break;
      }
    }
    // Periodic sync — runs entirely on core 0, never stalls the UI loop.
    if (wifiOk && millis() - lastSync > WEBAPP_SYNC_PERIOD_MS) {
      lastSync = millis();
      _doWebappSyncPull();
      maybeSyncRtc(false);
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
