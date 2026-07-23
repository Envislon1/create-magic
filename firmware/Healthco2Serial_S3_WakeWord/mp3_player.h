// =============================================================================
// mp3_player.h — SD-card MP3/WAV playback for Healthco2Serial_S3_WakeWord
// =============================================================================
// Arduino Library Manager requirements:
//   - ESP8266Audio by Earle F. Philhower III
//   - SD (bundled with the ESP32 Arduino core)
//
// SD wiring used here:
//   CS=35, MOSI=37, MISO=38, SCK=36, 3V3, GND
// Put files in /music on a FAT32-formatted card.
// =============================================================================

#pragma once
#include <Arduino.h>
#include <vector>
#include <SPI.h>
#include <SD.h>
#include <AudioFileSourceSD.h>
#include <AudioGeneratorMP3.h>
#include <AudioGeneratorWAV.h>
#include <AudioOutput.h>
#include "driver/i2s.h"

// --- Pin map -----------------------------------------------------------------
#ifndef SD_CS_PIN
#define SD_CS_PIN   35
#endif
#ifndef SD_MOSI_PIN
#define SD_MOSI_PIN 37
#endif
#ifndef SD_MISO_PIN
#define SD_MISO_PIN 38
#endif
#ifndef SD_SCK_PIN
#define SD_SCK_PIN  36
#endif
#ifndef SPK_BCLK
#define SPK_BCLK 11
#endif
#ifndef SPK_LRC
#define SPK_LRC  13
#endif
#ifndef SPK_DIN
#define SPK_DIN  12
#endif
#ifndef MP3_I2S_PORT
#define MP3_I2S_PORT 1
#endif

// ESP8266Audio's built-in AudioOutputI2S uses the ESP32 Arduino 3.x "new"
// I2S driver, while the rest of this sketch uses the legacy driver/i2s.h API
// for mic + TTS. Mixing those drivers causes:
//   CONFLICT! The new i2s driver can't work along with the legacy i2s driver
// So MP3/WAV decoding uses this tiny AudioOutput adapter and writes decoded
// mono PCM into the already-initialised legacy speaker port instead.
class AudioOutputMindBuddyI2S : public AudioOutput {
public:
  explicit AudioOutputMindBuddyI2S(i2s_port_t port) : _port(port) {
    hertz = 44100;
    channels = 2;
    gainF2P6 = 1 << 6;
  }

  bool begin() override {
    _running = true;
    _pos = 0;
    i2s_zero_dma_buffer(_port);
    // Use i2s_set_clk to recompute BCLK + WS + sample-rate divider together
    // (i2s_set_sample_rates only touches the sample rate divider and leaves
    // a stale bit-clock when switching from the TTS rate to 44.1k, which
    // sounds like harsh static over the music).
    i2s_set_clk(_port, hertz, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    i2s_start(_port);
    return true;
  }

  bool SetRate(int hz) override {
    AudioOutput::SetRate(hz);
    if (_running) i2s_set_clk(_port, hz, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    return true;
  }

  bool ConsumeSample(int16_t sample[2]) override {
    if (!_running) return false;
    int32_t mixed = sample[LEFTCHANNEL];
    if (channels > 1) mixed = ((int32_t)sample[LEFTCHANNEL] + (int32_t)sample[RIGHTCHANNEL]) / 2;
    // Soft headroom: leave ~10% so combined mp3Volume*speakerVolume gain
    // can't push peaks into the hard clipper inside Amplify().
    mixed = (mixed * 29) / 32;  // ~0.906
    _buf[_pos++] = Amplify((int16_t)mixed);
    if (_pos < BUFFER_SAMPLES) return true;
    return writeBuffer();
  }

  uint16_t ConsumeSamples(int16_t* samples, uint16_t count) override {
    for (uint16_t i = 0; i < count; i++) {
      if (!ConsumeSample(samples + (i * 2))) return i;
    }
    return count;
  }

  void flush() override { writeBuffer(); }

  bool stop() override {
    flush();
    _running = false;
    static int16_t silence[256];
    size_t bw = 0;
    for (int i = 0; i < 3; i++) i2s_write(_port, silence, sizeof(silence), &bw, pdMS_TO_TICKS(50));
    return true;
  }

private:
  static const size_t BUFFER_SAMPLES = 1024;  // 2048 bytes per write — fewer
                                              // i2s_write calls, less chance
                                              // of DMA underrun jitter.
  i2s_port_t _port;
  bool _running = false;
  size_t _pos = 0;
  int16_t _buf[BUFFER_SAMPLES];

  bool writeBuffer() {
    if (_pos == 0) return true;
    size_t bw = 0;
    // 200 ms timeout instead of portMAX_DELAY: if DMA stalls we surface it
    // instead of blocking the audio task forever (which itself creates
    // gaps that sound like static when playback resumes).
    esp_err_t err = i2s_write(_port, _buf, _pos * sizeof(int16_t), &bw, pdMS_TO_TICKS(200));
    _pos = 0;
    return err == ESP_OK;
  }
};


// --- State -------------------------------------------------------------------
static bool                    mp3ModeActive = false;
static bool                    mp3SdReady    = false;
static std::vector<String>     mp3Playlist;
static int                     mp3Index      = 0;
static bool                    mp3Paused     = false;
static uint8_t                 mp3Volume     = 70;   // 0..100
static AudioGeneratorMP3*      g_mp3         = nullptr;
static AudioGeneratorWAV*      g_wav         = nullptr;
static AudioFileSourceSD*      g_file        = nullptr;
static AudioOutputMindBuddyI2S* g_out        = nullptr;

// Buttons shared with the main sketch.
extern void beep(int d);
extern void returnToIdle();
extern void initI2SSpeaker();
extern bool soundEnabled;
extern volatile bool musicPlaying;
extern volatile bool gInterrupt;
extern volatile bool stopMusicFlag;
extern uint8_t speakerVolume;
#ifndef BTN_TALK
#define BTN_TALK   18
#define BTN_PREV   15
#define BTN_NEXT   16
#define BTN_SELECT 7
#endif

bool mp3IsActive() { return mp3ModeActive; }

static bool mp3IsPlayableName(String name) {
  name.toLowerCase();
  return name.endsWith(".mp3") || name.endsWith(".wav");
}

static String mp3JoinPath(const String& base, const String& name) {
  if (name.startsWith("/")) return name;
  String out = base.startsWith("/") ? base : String("/") + base;
  if (!out.endsWith("/")) out += "/";
  out += name;
  out.replace("//", "/");
  return out;
}

static void mp3ScanDir(File& dir, const String& base) {
  while (true) {
    File entry = dir.openNextFile();
    if (!entry) break;
    String name = String(entry.name());
    String full = mp3JoinPath(base, name);
    if (entry.isDirectory()) {
      mp3ScanDir(entry, full);
    } else if (mp3IsPlayableName(full)) {
      mp3Playlist.push_back(full);
      Serial.printf("[MP3] found: %s\n", full.c_str());
    }
    entry.close();
  }
}

static bool mp3EnsureSdReady() {
  if (mp3SdReady) return true;
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);
  if (!SD.begin(SD_CS_PIN, SPI, 20000000)) {
    Serial.println(F("[MP3] SD init failed. Check CS=35 MOSI=37 MISO=38 SCK=36 and FAT32 card."));
    return false;
  }
  mp3SdReady = true;
  Serial.println(F("[MP3] SD mounted"));
  return true;
}

static void mp3ScanCard() {
  mp3Playlist.clear();
  if (!mp3EnsureSdReady()) {
    Serial.println(F("[MP3] 0 tracks found on SD"));
    return;
  }
  String scanBase = "/music";
  File dir = SD.open(scanBase);
  if (!dir || !dir.isDirectory()) {
    Serial.println(F("[MP3] /music folder not found; scanning SD root instead"));
    if (dir) dir.close();
    scanBase = "/";
    dir = SD.open("/");
  }
  if (dir) {
    mp3ScanDir(dir, scanBase);
    dir.close();
  }
  Serial.printf("[MP3] %u tracks found on SD\n", (unsigned)mp3Playlist.size());
}

static void mp3DrawScreen(Adafruit_SSD1306& display) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print(F("MP3 "));
  if (mp3Playlist.empty()) {
    display.print(F("(no SD)"));
  } else {
    display.print(mp3Index + 1);
    display.print('/');
    display.print((int)mp3Playlist.size());
  }
  display.setCursor(0, 12);
  if (!mp3Playlist.empty()) {
    String name = mp3Playlist[mp3Index];
    int slash = name.lastIndexOf('/');
    if (slash >= 0) name = name.substring(slash + 1);
    if (name.length() > 21) name = name.substring(0, 21);
    display.print(name);
  } else {
    display.print(F("Insert SD card"));
  }
  display.setCursor(0, 24);
  display.print(mp3Paused ? F("PAUSED  vol ") : F("PLAYING vol "));
  display.print(mp3Volume);
  display.display();
}

extern Adafruit_SSD1306 display;

void mp3PlayerBegin() {
  mp3EnsureSdReady();
  mp3ScanCard();
}

static void mp3CloseDecoder(bool restoreSpeaker) {
  if (g_mp3) { if (g_mp3->isRunning()) g_mp3->stop(); delete g_mp3; g_mp3 = nullptr; }
  if (g_wav) { if (g_wav->isRunning()) g_wav->stop(); delete g_wav; g_wav = nullptr; }
  if (g_out) g_out->flush();
  if (g_file) { delete g_file; g_file = nullptr; }
  if (g_out)  { delete g_out;  g_out = nullptr; }
  if (restoreSpeaker) initI2SSpeaker();
}

static void mp3PlayCurrent() {
  if (mp3Playlist.empty()) return;
  mp3CloseDecoder(false);
  i2s_zero_dma_buffer((i2s_port_t)MP3_I2S_PORT);
  String path = mp3Playlist[mp3Index];
  String lower = path;
  lower.toLowerCase();
  g_file = new AudioFileSourceSD(path.c_str());
  g_out = new AudioOutputMindBuddyI2S((i2s_port_t)MP3_I2S_PORT);
  {
    float g = (float)mp3Volume / 100.0f * ((float)speakerVolume / 100.0f);
    if (g > 1.0f) g = 1.0f;  // never overdrive Amplify()'s hard clipper
    g_out->SetGain(g);
  }
  bool ok = false;
  if (lower.endsWith(".wav")) {
    g_wav = new AudioGeneratorWAV();
    ok = g_wav->begin(g_file, g_out);
  } else {
    g_mp3 = new AudioGeneratorMP3();
    ok = g_mp3->begin(g_file, g_out);
  }
  Serial.printf("[MP3] play: %s (%s)\n", path.c_str(), ok ? "ok" : "failed");
  if (!ok) {
    mp3CloseDecoder(true);
    return;
  }
  mp3Paused = false;
}
static void mp3StopAll() {
  mp3CloseDecoder(true);
  mp3Paused = true;
  musicPlaying = false;
}

// Called by the server-side action dispatcher.
void mp3EnterModeAndPlay(const String& query) {
  mp3ModeActive = true;
  musicPlaying = true;
  stopMusicFlag = false;
  if (mp3Playlist.empty()) mp3ScanCard();
  if (query.length() && !mp3Playlist.empty()) {
    String q = query; q.toLowerCase();
    for (size_t i = 0; i < mp3Playlist.size(); i++) {
      String n = mp3Playlist[i]; n.toLowerCase();
      if (n.indexOf(q) >= 0) { mp3Index = i; break; }
    }
  }
  mp3PlayCurrent();
  mp3DrawScreen(display);
}

// Drop-in loop hook — call from the main Arduino loop().
void mp3PlayerLoop() {
  if (!mp3ModeActive) return;

  if (stopMusicFlag || gInterrupt) {
    stopMusicFlag = false;
    mp3StopAll();
    mp3ModeActive = false;
    returnToIdle();
    return;
  }

  if (!mp3Paused) {
    bool hadDecoder = (g_mp3 != nullptr) || (g_wav != nullptr);
    bool running = false;
    if (g_mp3 && g_mp3->isRunning()) running = g_mp3->loop();
    if (g_wav && g_wav->isRunning()) running = g_wav->loop();
    if (hadDecoder && !running && !mp3Playlist.empty()) {
      mp3CloseDecoder(false);
      mp3Index = (mp3Index + 1) % mp3Playlist.size();
      mp3PlayCurrent();
      mp3DrawScreen(display);
    }
  }

  // Buttons — only while MP3 mode is active.
  static unsigned long pressStart[4] = {0,0,0,0};
  const int pins[4] = { BTN_TALK, BTN_PREV, BTN_NEXT, BTN_SELECT };
  for (int i = 0; i < 4; i++) {
    bool down = (digitalRead(pins[i]) == LOW);
    if (down && pressStart[i] == 0) pressStart[i] = millis();
    if (!down && pressStart[i] != 0) {
      unsigned long held = millis() - pressStart[i];
      pressStart[i] = 0;
      if (held < 30) continue;          // debounce
      bool isLong = held >= 600;
      switch (pins[i]) {
        case BTN_TALK:                   // exit MP3 -> idle
          mp3StopAll();
          mp3ModeActive = false;
          beep(40);
          returnToIdle();
          return;
        case BTN_PREV:
          if (isLong) {
            if (mp3Volume >= 5) mp3Volume -= 5;
            if (g_out) { float g = (float)mp3Volume/100.0f*(float)speakerVolume/100.0f; if (g>1.0f) g=1.0f; g_out->SetGain(g); }
          } else if (!mp3Playlist.empty()) {
            mp3Index = (mp3Index + mp3Playlist.size() - 1) % mp3Playlist.size();
            mp3PlayCurrent();
          }
          mp3DrawScreen(display);
          break;
        case BTN_NEXT:
          if (isLong) {
            if (mp3Volume <= 95) mp3Volume += 5;
            if (g_out) { float g = (float)mp3Volume/100.0f*(float)speakerVolume/100.0f; if (g>1.0f) g=1.0f; g_out->SetGain(g); }
          } else if (!mp3Playlist.empty()) {
            mp3Index = (mp3Index + 1) % mp3Playlist.size();
            mp3PlayCurrent();
          }
          mp3DrawScreen(display);
          break;
        case BTN_SELECT:
          mp3Paused = !mp3Paused;
          mp3DrawScreen(display);
          break;
      }
    }
  }
}
