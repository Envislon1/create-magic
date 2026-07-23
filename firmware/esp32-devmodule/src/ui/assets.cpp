#include "ui/assets.h"
#include "ui/theme.h"
#include "config.h"

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <FS.h>
#include <lvgl.h>

namespace {

bool g_sd_ready = false;
bool g_fs_registered = false;
lv_fs_drv_t g_drv;

// --------- LVGL <-> Arduino SD glue ---------
static void* fs_open(lv_fs_drv_t* /*drv*/, const char* path, lv_fs_mode_t mode) {
  if (!g_sd_ready) return nullptr;
  // LVGL strips the "S:" prefix before calling us. Prepend the asset root.
  String full = String(MB_ASSET_ROOT "/") + path;
  const char* fmode = (mode & LV_FS_MODE_WR) ? FILE_WRITE : FILE_READ;
  File f = SD.open(full.c_str(), fmode);
  if (!f) return nullptr;
  // Move to heap so we can return a stable pointer LVGL keeps.
  File* h = new File(f);
  return (void*)h;
}
static lv_fs_res_t fs_close(lv_fs_drv_t*, void* fh) {
  File* h = (File*)fh; if (!h) return LV_FS_RES_INV_PARAM;
  h->close(); delete h;
  return LV_FS_RES_OK;
}
static lv_fs_res_t fs_read(lv_fs_drv_t*, void* fh, void* buf, uint32_t n, uint32_t* br) {
  File* h = (File*)fh; if (!h) return LV_FS_RES_INV_PARAM;
  int r = h->read((uint8_t*)buf, n);
  if (r < 0) { *br = 0; return LV_FS_RES_UNKNOWN; }
  *br = (uint32_t)r;
  return LV_FS_RES_OK;
}
static lv_fs_res_t fs_seek(lv_fs_drv_t*, void* fh, uint32_t pos, lv_fs_whence_t w) {
  File* h = (File*)fh; if (!h) return LV_FS_RES_INV_PARAM;
  SeekMode m = w == LV_FS_SEEK_SET ? SeekSet
             : w == LV_FS_SEEK_CUR ? SeekCur
             : SeekEnd;
  return h->seek(pos, m) ? LV_FS_RES_OK : LV_FS_RES_UNKNOWN;
}
static lv_fs_res_t fs_tell(lv_fs_drv_t*, void* fh, uint32_t* p) {
  File* h = (File*)fh; if (!h) return LV_FS_RES_INV_PARAM;
  *p = (uint32_t)h->position();
  return LV_FS_RES_OK;
}

static void register_fs_driver() {
  if (g_fs_registered) return;
  lv_fs_drv_init(&g_drv);
  g_drv.letter    = 'S';
  g_drv.open_cb   = fs_open;
  g_drv.close_cb  = fs_close;
  g_drv.read_cb   = fs_read;
  g_drv.seek_cb   = fs_seek;
  g_drv.tell_cb   = fs_tell;
  lv_fs_drv_register(&g_drv);
  g_fs_registered = true;
}

// --------- Path helpers ---------
// LVGL image sources need stable, null-terminated storage. We keep small
// per-slot String buffers rather than reallocating on every call, so the
// pointer we hand LVGL stays valid until we overwrite the same slot.
struct SlotBuf { String s; };
static SlotBuf g_bg_slot;
static SlotBuf g_icon_slot;
static SlotBuf g_avatar_slot;

static bool sd_has(const char* path) {
  if (!g_sd_ready) return false;
  return SD.exists(path);
}

static const char* bg_name(assets::Bg b) {
  using B = assets::Bg;
  switch (b) {
    case B::Splash:   return "splash";
    case B::Wifi:     return "wifi";
    case B::Home:     return "home";
    case B::Chat:     return "chat";
    case B::Modes:    return "modes";
    case B::Meds:     return "meds";
    case B::Music:    return "music";
    case B::Dial:     return "dial";
    case B::Sms:      return "sms";
    case B::Settings: return "settings";
  }
  return "home";
}

static const char* avatar_name(assets::AvatarState s) {
  switch (s) {
    case assets::AvatarState::Idle:   return "buddy_idle";
    case assets::AvatarState::Listen: return "buddy_listen";
    case assets::AvatarState::Think:  return "buddy_think";
    case assets::AvatarState::Speak:  return "buddy_speak";
  }
  return "buddy_idle";
}

} // namespace

namespace assets {

void begin() {
  Serial.printf("[assets] SD.begin(CS=%d) ...\n", SD_CS_PIN);
  // TFT_eSPI already owns VSPI (pins 18/19/23). SD reuses the same bus with
  // its own chip-select, so we do NOT call SPI.begin() again.
  if (SD.begin(SD_CS_PIN)) {
    g_sd_ready = true;
    uint64_t sz = SD.cardSize() / (1024ULL * 1024ULL);
    Serial.printf("[assets] SD ok, %llu MB\n", (unsigned long long)sz);
  } else {
    g_sd_ready = false;
    Serial.println(F("[assets] SD.begin failed — running without card, "
                     "UI will use fallback colors."));
  }
  register_fs_driver();
  theme::load();
}

bool ready() { return g_sd_ready; }

const char* bg(Bg page) {
  if (!g_sd_ready) return nullptr;
  String fs = String(MB_ASSET_ROOT "/backgrounds/") + bg_name(page) + ".bin";
  if (!SD.exists(fs.c_str())) return nullptr;
  g_bg_slot.s = String("S:backgrounds/") + bg_name(page) + ".bin";
  return g_bg_slot.s.c_str();
}

const char* icon(const char* group, const char* name) {
  if (!g_sd_ready || !group || !name) return nullptr;
  String fs = String(MB_ASSET_ROOT "/icons/") + group + "/" + name + ".bin";
  if (!SD.exists(fs.c_str())) return nullptr;
  g_icon_slot.s = String("S:icons/") + group + "/" + name + ".bin";
  return g_icon_slot.s.c_str();
}

const char* avatar(AvatarState s) {
  if (!g_sd_ready) return nullptr;
  String fs = String(MB_ASSET_ROOT "/avatars/") + avatar_name(s) + ".bin";
  if (!SD.exists(fs.c_str())) return nullptr;
  g_avatar_slot.s = String("S:avatars/") + avatar_name(s) + ".bin";
  return g_avatar_slot.s.c_str();
}

} // namespace assets
