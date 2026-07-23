// MindBuddy TFT UI for the ESP32 DevModule.
//
// Instead of building every page from raw shapes and hardcoded hex colors
// in DRAM, this build:
//   * pulls page backgrounds from an SD card mounted at /mindbuddy/,
//   * pulls nav / media / mood icons from the same card,
//   * reads all colors from /mindbuddy/theme.json,
// which mirrors the design in "MindBuddy TFT Screen Pages" while keeping
// the ESP32's DRAM free for Wi-Fi + WiFiManager.
//
// If the SD card is missing (or a specific file isn't on it), each helper
// returns nullptr and we fall back to a flat-color layout so the board
// still boots and every page still works.

#include "ui/ui.h"
#include "ui/assets.h"
#include "ui/theme.h"
#include "config.h"
#include "state.h"
#include "link/link_bus.h"
#include <TFT_eSPI.h>

// ------------------ TFT + Touch ------------------
static TFT_eSPI tft = TFT_eSPI();
static uint16_t TOUCH_CAL[5] = { 191, 3570, 269, 3565, 1 };

static lv_display_t* s_disp = nullptr;
static lv_indev_t*   s_indev = nullptr;

static const uint32_t BUF_ROWS = 20;
static lv_color_t s_buf1[240 * BUF_ROWS];

static void disp_flush(lv_display_t* d, const lv_area_t* a, uint8_t* px) {
  uint32_t w = a->x2 - a->x1 + 1;
  uint32_t h = a->y2 - a->y1 + 1;
  tft.startWrite();
  tft.setAddrWindow(a->x1, a->y1, w, h);
  tft.pushPixels((uint16_t*)px, w * h);
  tft.endWrite();
  lv_display_flush_ready(d);
}

static void touch_read(lv_indev_t*, lv_indev_data_t* data) {
  uint16_t tx = 0, ty = 0;
  if (tft.getTouch(&tx, &ty, 40)) {
    data->point.x = constrain((int)tx, 0, 239);
    data->point.y = constrain((int)ty, 0, 319);
    data->state   = LV_INDEV_STATE_PRESSED;
  } else {
    data->state = LV_INDEV_STATE_RELEASED;
  }
}

// ------------------ Page objects ------------------
static lv_obj_t* p_splash = nullptr;
static lv_obj_t* p_wifi   = nullptr;
static lv_obj_t* p_home   = nullptr;
static lv_obj_t* p_chat   = nullptr;
static lv_obj_t* p_modes  = nullptr;
static lv_obj_t* p_meds   = nullptr;
static lv_obj_t* p_music  = nullptr;
static lv_obj_t* p_dial   = nullptr;
static lv_obj_t* p_sms    = nullptr;
static lv_obj_t* p_set    = nullptr;

static lv_obj_t* chat_list = nullptr;
static lv_obj_t* chat_pending = nullptr;
static lv_obj_t* chat_meta_lbl = nullptr;
static lv_obj_t* chat_avatar = nullptr;

// Home widgets
static lv_obj_t* home_status_lbl = nullptr;
static lv_obj_t* home_mode_lbl   = nullptr;
static lv_obj_t* home_backend_lbl= nullptr;

// Wifi widgets
static lv_obj_t* wifi_l1 = nullptr;
static lv_obj_t* wifi_l2 = nullptr;
static lv_obj_t* wifi_l3 = nullptr;

static ui::Page s_current = ui::Page::Splash;
static ui::Page s_last    = ui::Page::Home;

// ------------------ Style helpers ------------------
// Keep LVGL rendering flat (LV_DRAW_SW_COMPLEX=0 board). Any non-zero
// radius or shadow spams "Can't draw complex rectangle" warnings.
static void flatten_part(lv_obj_t* obj, lv_part_t part) {
  lv_obj_set_style_radius(obj, 0, part);
  lv_obj_set_style_shadow_width(obj, 0, part);
  lv_obj_set_style_shadow_opa(obj, LV_OPA_TRANSP, part);
  lv_obj_set_style_shadow_spread(obj, 0, part);
}
static void disable_shadows(lv_obj_t* obj) {
  if (!obj) return;
  static const lv_part_t parts[] = {
    LV_PART_MAIN, LV_PART_SCROLLBAR, LV_PART_INDICATOR,
    LV_PART_KNOB, LV_PART_SELECTED, LV_PART_ITEMS, LV_PART_CURSOR
  };
  for (lv_part_t part : parts) flatten_part(obj, part);
  uint32_t n = lv_obj_get_child_count(obj);
  for (uint32_t i = 0; i < n; ++i) disable_shadows(lv_obj_get_child(obj, i));
}

// Create a full-screen page container with a themed background. When an
// SD-card background is available for this page, it is layered underneath
// the widgets; otherwise we just paint a solid color from the palette.
static lv_obj_t* make_page(assets::Bg bg_id) {
  lv_obj_t* page = lv_obj_create(lv_screen_active());
  lv_obj_remove_style_all(page);
  lv_obj_set_size(page, 240, 320);
  lv_obj_set_style_bg_color(page, theme::p().bg, 0);
  lv_obj_set_style_bg_opa(page, LV_OPA_COVER, 0);
  const char* src = assets::bg(bg_id);
  if (src) {
    lv_obj_t* img = lv_image_create(page);
    lv_image_set_src(img, src);
    lv_obj_align(img, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_move_background(img);
  }
  return page;
}

// A themed button in the primary color. label_color forced to text.
static lv_obj_t* themed_button(lv_obj_t* parent, int w, int h, lv_color_t bg) {
  lv_obj_t* b = lv_button_create(parent);
  lv_obj_set_size(b, w, h);
  lv_obj_set_style_bg_color(b, bg, 0);
  lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
  lv_obj_set_style_text_color(b, theme::p().text, 0);
  lv_obj_set_style_radius(b, 0, 0);
  lv_obj_set_style_shadow_width(b, 0, 0);
  lv_obj_set_style_border_width(b, 0, 0);
  return b;
}

// A nav tile: icon on top (if SD has it), label beneath — matches the
// bottom-nav strip from the Figma design.
static lv_obj_t* nav_tile(lv_obj_t* parent, int x, int y, int w, int h,
                          const char* icon_name, const char* label) {
  lv_obj_t* b = themed_button(parent, w, h, theme::p().surface);
  lv_obj_set_pos(b, x, y);
  lv_obj_set_flex_flow(b, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_flex_align(b, LV_FLEX_ALIGN_CENTER,
                        LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_all(b, 2, 0);
  const char* isrc = assets::icon("nav", icon_name);
  if (isrc) {
    lv_obj_t* im = lv_image_create(b);
    lv_image_set_src(im, isrc);
  }
  lv_obj_t* l = lv_label_create(b);
  lv_label_set_text(l, label);
  lv_obj_set_style_text_color(l, theme::p().text, 0);
  return b;
}

// ------------------ Forward decls ------------------
static void build_splash();
static void build_wifi();
static void build_home();
static void build_chat();
static void build_modes();
static void build_meds();
static void build_music();
static void build_dial();
static void build_sms();
static void build_settings();
static void hide_all();
static void refresh_home();

// ------------------ Back button ------------------
static void add_back_btn(lv_obj_t* parent) {
  lv_obj_t* b = themed_button(parent, 60, 32, theme::p().surface);
  lv_obj_align(b, LV_ALIGN_TOP_LEFT, 4, 4);
  const char* isrc = assets::icon("actions", "back");
  if (isrc) {
    lv_obj_t* im = lv_image_create(b);
    lv_image_set_src(im, isrc);
    lv_obj_center(im);
  } else {
    lv_obj_t* l = lv_label_create(b);
    lv_label_set_text(l, LV_SYMBOL_LEFT " Back");
    lv_obj_center(l);
  }
  lv_obj_add_event_cb(b, [](lv_event_t*){ ui::back(); }, LV_EVENT_CLICKED, nullptr);
}

// ------------------ Page builders ------------------
static void build_splash() {
  p_splash = make_page(assets::Bg::Splash);

  lv_obj_t* t = lv_label_create(p_splash);
  lv_label_set_text(t, theme::brand());
  lv_obj_set_style_text_font(t, &lv_font_montserrat_28, 0);
  lv_obj_set_style_text_color(t, theme::p().text, 0);
  lv_obj_set_style_text_align(t, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(t, LV_ALIGN_CENTER, 0, -30);

  lv_obj_t* tag = lv_label_create(p_splash);
  lv_label_set_text(tag, theme::tagline());
  lv_obj_set_style_text_color(tag, theme::p().accent, 0);
  lv_obj_align(tag, LV_ALIGN_CENTER, 0, 0);

  lv_obj_t* code = lv_label_create(p_splash);
  lv_label_set_text_fmt(code, "Code: %s", app_state::device_code.c_str());
  lv_obj_set_style_text_color(code, theme::p().muted, 0);
  lv_obj_align(code, LV_ALIGN_CENTER, 0, 40);

  lv_obj_t* fw = lv_label_create(p_splash);
  lv_label_set_text_fmt(fw, "fw %s  \xC2\xB7  SD:%s",
                        FW_VERSION, assets::ready() ? "ok" : "off");
  lv_obj_set_style_text_color(fw, theme::p().muted, 0);
  lv_obj_align(fw, LV_ALIGN_BOTTOM_MID, 0, -8);
}

static void build_wifi() {
  p_wifi = make_page(assets::Bg::Wifi);
  lv_obj_set_style_pad_all(p_wifi, 8, 0);

  lv_obj_t* h = lv_label_create(p_wifi);
  lv_label_set_text(h, "Wi-Fi Setup");
  lv_obj_set_style_text_font(h, &lv_font_montserrat_20, 0);
  lv_obj_set_style_text_color(h, theme::p().text, 0);
  lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 4);

  wifi_l1 = lv_label_create(p_wifi); lv_label_set_long_mode(wifi_l1, LV_LABEL_LONG_WRAP);
  wifi_l2 = lv_label_create(p_wifi); lv_label_set_long_mode(wifi_l2, LV_LABEL_LONG_WRAP);
  wifi_l3 = lv_label_create(p_wifi); lv_label_set_long_mode(wifi_l3, LV_LABEL_LONG_WRAP);
  for (lv_obj_t* l : {wifi_l1, wifi_l2, wifi_l3}) {
    lv_obj_set_width(l, 220);
    lv_obj_set_style_text_color(l, theme::p().text, 0);
  }
  lv_obj_align(wifi_l1, LV_ALIGN_TOP_LEFT, 4, 44);
  lv_obj_align(wifi_l2, LV_ALIGN_TOP_LEFT, 4, 100);
  lv_obj_align(wifi_l3, LV_ALIGN_TOP_LEFT, 4, 160);

  ui::wifiSetPortalInfo(
    "1. Join Wi-Fi \"" WM_AP_NAME "\" on your phone",
    "2. Portal opens automatically",
    "3. Pick your network + enter password");
}

static void build_home() {
  p_home = make_page(assets::Bg::Home);
  lv_obj_set_style_pad_all(p_home, 6, 0);

  home_status_lbl = lv_label_create(p_home);
  lv_label_set_text(home_status_lbl, theme::brand());
  lv_obj_set_style_text_font(home_status_lbl, &lv_font_montserrat_20, 0);
  lv_obj_set_style_text_color(home_status_lbl, theme::p().text, 0);
  lv_obj_align(home_status_lbl, LV_ALIGN_TOP_MID, 0, 4);

  home_mode_lbl = lv_label_create(p_home);
  lv_obj_set_style_text_color(home_mode_lbl, theme::p().muted, 0);
  lv_obj_align(home_mode_lbl, LV_ALIGN_TOP_MID, 0, 34);

  home_backend_lbl = lv_label_create(p_home);
  lv_obj_set_style_text_color(home_backend_lbl, theme::p().muted, 0);
  lv_obj_align(home_backend_lbl, LV_ALIGN_TOP_MID, 0, 54);

  // Big circular-feel Talk button in primary teal.
  lv_obj_t* talk = themed_button(p_home, 140, 140, theme::p().primary);
  lv_obj_align(talk, LV_ALIGN_CENTER, 0, 0);
  const char* talk_icon = assets::icon("actions", "talk");
  if (talk_icon) {
    lv_obj_t* im = lv_image_create(talk); lv_image_set_src(im, talk_icon);
    lv_obj_center(im);
  } else {
    lv_obj_t* tl = lv_label_create(talk);
    lv_label_set_text(tl, LV_SYMBOL_AUDIO "\nTalk");
    lv_obj_set_style_text_align(tl, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_center(tl);
  }
  lv_obj_add_event_cb(talk, [](lv_event_t*){
    link_bus::sendWake(); ui::goTo(ui::Page::Chat);
  }, LV_EVENT_CLICKED, nullptr);

  // Bottom nav (Figma layout): Modes | Meds | Music | Dial | SMS | Settings
  struct Tile { const char* icon; const char* label; ui::Page page; };
  static const Tile tiles[6] = {
    { "brain",    "Modes",    ui::Page::Modes    },
    { "bell",     "Meds",     ui::Page::Meds     },
    { "music",    "Music",    ui::Page::Music    },
    { "chat",     "Dial",     ui::Page::Dial     },
    { "message",  "SMS",      ui::Page::Sms      },
    { "settings", "Settings", ui::Page::Settings },
  };
  for (int i = 0; i < 6; ++i) {
    int col = i % 3, row = i / 3;
    lv_obj_t* b = nav_tile(p_home, 6 + col * 76, 210 + row * 46, 72, 40,
                           tiles[i].icon, tiles[i].label);
    lv_obj_set_user_data(b, (void*)tiles[i].page);
    lv_obj_add_event_cb(b, [](lv_event_t* e){
      ui::goTo((ui::Page)(intptr_t)lv_obj_get_user_data(lv_event_get_target_obj(e)));
    }, LV_EVENT_CLICKED, nullptr);
  }
}

static void build_chat() {
  p_chat = make_page(assets::Bg::Chat);
  lv_obj_set_style_pad_all(p_chat, 4, 0);
  add_back_btn(p_chat);

  lv_obj_t* title = lv_label_create(p_chat);
  lv_label_set_text(title, "Chat");
  lv_obj_set_style_text_color(title, theme::p().text, 0);
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 10);

  const char* av = assets::avatar(assets::AvatarState::Idle);
  if (av) {
    chat_avatar = lv_image_create(p_chat);
    lv_image_set_src(chat_avatar, av);
    lv_obj_align(chat_avatar, LV_ALIGN_TOP_RIGHT, -4, 4);
  }

  chat_list = lv_obj_create(p_chat);
  lv_obj_set_size(chat_list, 232, 216);
  lv_obj_align(chat_list, LV_ALIGN_TOP_MID, 0, 44);
  lv_obj_set_style_bg_color(chat_list, theme::p().surface, 0);
  lv_obj_set_style_border_width(chat_list, 0, 0);
  lv_obj_set_flex_flow(chat_list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_scroll_dir(chat_list, LV_DIR_VER);

  chat_meta_lbl = lv_label_create(p_chat);
  lv_label_set_text(chat_meta_lbl, "");
  lv_obj_set_style_text_color(chat_meta_lbl, theme::p().accent, 0);
  lv_obj_align(chat_meta_lbl, LV_ALIGN_BOTTOM_MID, 0, -44);

  lv_obj_t* talk = themed_button(p_chat, 90, 34, theme::p().primary);
  lv_obj_align(talk, LV_ALIGN_BOTTOM_MID, 0, -4);
  const char* mic = assets::icon("actions", "mic");
  if (mic) { lv_obj_t* im = lv_image_create(talk); lv_image_set_src(im, mic); lv_obj_center(im); }
  else     { lv_obj_t* tl = lv_label_create(talk); lv_label_set_text(tl, LV_SYMBOL_AUDIO " Talk"); lv_obj_center(tl); }
  lv_obj_add_event_cb(talk, [](lv_event_t*){ link_bus::sendWake(); }, LV_EVENT_CLICKED, nullptr);
}

static void build_modes() {
  p_modes = make_page(assets::Bg::Modes);
  lv_obj_set_style_pad_all(p_modes, 6, 0);
  add_back_btn(p_modes);

  lv_obj_t* title = lv_label_create(p_modes);
  lv_label_set_text(title, "Support Mode");
  lv_obj_set_style_text_color(title, theme::p().text, 0);
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 10);

  lv_obj_t* list = lv_list_create(p_modes);
  lv_obj_set_size(list, 232, 260);
  lv_obj_align(list, LV_ALIGN_TOP_MID, 0, 44);
  lv_obj_set_style_bg_color(list, theme::p().surface, 0);
  lv_obj_set_style_border_width(list, 0, 0);
  static const char* modes[] = {"ANXIETY","DEPRESSION","PTSD","ADHD","BIPOLAR","SCHIZOPHRENIA","GENERAL"};
  for (auto m : modes) {
    lv_obj_t* it = lv_list_add_button(list, LV_SYMBOL_OK, m);
    lv_obj_set_style_text_color(it, theme::p().text, 0);
    lv_obj_set_user_data(it, (void*)m);
    lv_obj_add_event_cb(it, [](lv_event_t* e){
      const char* m = (const char*)lv_obj_get_user_data(lv_event_get_target_obj(e));
      app_state::mode = m;
      link_bus::sendModeSet(m);
      app_state::notifyChanged();
      ui::back();
    }, LV_EVENT_CLICKED, nullptr);
  }
}

static void build_meds() {
  p_meds = make_page(assets::Bg::Meds);
  add_back_btn(p_meds);
  lv_obj_t* t = lv_label_create(p_meds);
  lv_label_set_text(t, "Medication");
  lv_obj_set_style_text_color(t, theme::p().text, 0);
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);

  lv_obj_t* info = lv_label_create(p_meds);
  lv_label_set_long_mode(info, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(info, 220);
  lv_label_set_text(info, "Reminders sync from the web app.\nOpen 'Meds' there to add or edit.");
  lv_obj_set_style_text_color(info, theme::p().muted, 0);
  lv_obj_align(info, LV_ALIGN_CENTER, 0, 0);
}

static void build_music() {
  p_music = make_page(assets::Bg::Music);
  add_back_btn(p_music);
  lv_obj_t* t = lv_label_create(p_music);
  lv_label_set_text(t, "Music");
  lv_obj_set_style_text_color(t, theme::p().text, 0);
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);

  lv_obj_t* np = lv_label_create(p_music);
  lv_label_set_text(np, "Nothing playing");
  lv_obj_set_style_text_color(np, theme::p().muted, 0);
  lv_obj_align(np, LV_ALIGN_CENTER, 0, -20);

  static const char* cmds[4] = {"prev","play","pause","next"};
  static const char* syms[4] = {LV_SYMBOL_PREV, LV_SYMBOL_PLAY, LV_SYMBOL_PAUSE, LV_SYMBOL_NEXT};
  for (int i = 0; i < 4; ++i) {
    lv_obj_t* b = themed_button(p_music, 48, 48, theme::p().surface);
    lv_obj_set_pos(b, 12 + i * 56, 220);
    const char* isrc = assets::icon("media", cmds[i]);
    if (isrc) { lv_obj_t* im = lv_image_create(b); lv_image_set_src(im, isrc); lv_obj_center(im); }
    else      { lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, syms[i]); lv_obj_center(l); }
    lv_obj_set_user_data(b, (void*)cmds[i]);
    lv_obj_add_event_cb(b, [](lv_event_t* e){
      link_bus::sendMusic((const char*)lv_obj_get_user_data(lv_event_get_target_obj(e)));
    }, LV_EVENT_CLICKED, nullptr);
  }
}

static void build_dial() {
  p_dial = make_page(assets::Bg::Dial);
  add_back_btn(p_dial);
  lv_obj_t* t = lv_label_create(p_dial);
  lv_label_set_text(t, "Dial");
  lv_obj_set_style_text_color(t, theme::p().text, 0);
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);

  static lv_obj_t* num = lv_textarea_create(p_dial);
  lv_textarea_set_one_line(num, true);
  lv_textarea_set_placeholder_text(num, "+234...");
  lv_obj_set_size(num, 220, 40);
  lv_obj_align(num, LV_ALIGN_TOP_MID, 0, 44);
  lv_obj_add_state(num, LV_STATE_FOCUSED);

  static const char* keys[12] = {"1","2","3","4","5","6","7","8","9","*","0","#"};
  for (int i = 0; i < 12; ++i) {
    lv_obj_t* b = themed_button(p_dial, 60, 40, theme::p().surface);
    lv_obj_set_pos(b, 12 + (i % 3) * 72, 96 + (i / 3) * 46);
    lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, keys[i]); lv_obj_center(l);
    lv_obj_set_user_data(b, (void*)keys[i]);
    lv_obj_add_event_cb(b, [](lv_event_t* e){
      lv_textarea_add_text(num, (const char*)lv_obj_get_user_data(lv_event_get_target_obj(e)));
    }, LV_EVENT_CLICKED, nullptr);
  }

  lv_obj_t* call = themed_button(p_dial, 220, 40, theme::p().primary);
  lv_obj_align(call, LV_ALIGN_BOTTOM_MID, 0, -4);
  const char* isrc = assets::icon("phone", "call");
  if (isrc) { lv_obj_t* im = lv_image_create(call); lv_image_set_src(im, isrc); lv_obj_center(im); }
  else      { lv_obj_t* cl = lv_label_create(call); lv_label_set_text(cl, LV_SYMBOL_CALL " Call"); lv_obj_center(cl); }
  lv_obj_add_event_cb(call, [](lv_event_t*){
    const char* n = lv_textarea_get_text(num);
    if (n && *n) { link_bus::sendCallAnswered(n); ui::toast("Dialing..."); }
  }, LV_EVENT_CLICKED, nullptr);
}

static void build_sms() {
  p_sms = make_page(assets::Bg::Sms);
  add_back_btn(p_sms);
  lv_obj_t* t = lv_label_create(p_sms);
  lv_label_set_text(t, "SMS");
  lv_obj_set_style_text_color(t, theme::p().text, 0);
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);

  lv_obj_t* info = lv_label_create(p_sms);
  lv_label_set_long_mode(info, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(info, 220);
  lv_label_set_text(info, "Incoming SMS shows here.\nCompose via the web app for now.");
  lv_obj_set_style_text_color(info, theme::p().muted, 0);
  lv_obj_align(info, LV_ALIGN_CENTER, 0, 0);
}

static void build_settings() {
  p_set = make_page(assets::Bg::Settings);
  add_back_btn(p_set);
  lv_obj_t* t = lv_label_create(p_set);
  lv_label_set_text(t, "Settings");
  lv_obj_set_style_text_color(t, theme::p().text, 0);
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);

  lv_obj_t* vlbl = lv_label_create(p_set);
  lv_label_set_text(vlbl, "Volume");
  lv_obj_set_style_text_color(vlbl, theme::p().muted, 0);
  lv_obj_align(vlbl, LV_ALIGN_TOP_LEFT, 8, 40);
  lv_obj_t* v = lv_slider_create(p_set);
  lv_slider_set_range(v, 0, 100);
  lv_slider_set_value(v, app_state::volume, LV_ANIM_OFF);
  lv_obj_set_size(v, 220, 16);
  lv_obj_align(v, LV_ALIGN_TOP_MID, 0, 62);
  lv_obj_set_style_bg_color(v, theme::p().primary, LV_PART_INDICATOR);
  lv_obj_set_style_bg_color(v, theme::p().primary, LV_PART_KNOB);
  lv_obj_add_event_cb(v, [](lv_event_t* e){
    int val = lv_slider_get_value(lv_event_get_target_obj(e));
    app_state::volume = val; link_bus::sendVolume(val);
  }, LV_EVENT_VALUE_CHANGED, nullptr);

  auto pill_row = [&](const char* label, int y, int count,
                      const char* const* vals, const char* const* lbls,
                      lv_event_cb_t cb) {
    lv_obj_t* lb = lv_label_create(p_set);
    lv_label_set_text(lb, label);
    lv_obj_set_style_text_color(lb, theme::p().muted, 0);
    lv_obj_align(lb, LV_ALIGN_TOP_LEFT, 8, y);
    int tw = 220 / count;
    for (int i = 0; i < count; ++i) {
      lv_obj_t* b = themed_button(p_set, tw - 4, 30, theme::p().surface);
      lv_obj_set_pos(b, 8 + i * tw, y + 18);
      lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, lbls[i]); lv_obj_center(l);
      lv_obj_set_user_data(b, (void*)vals[i]);
      lv_obj_add_event_cb(b, cb, LV_EVENT_CLICKED, nullptr);
    }
  };

  static const char* pipeV[3] = {"auto","online","offline"};
  static const char* pipeL[3] = {"Auto","Online","Offline"};
  pill_row("Pipeline", 92, 3, pipeV, pipeL, [](lv_event_t* e){
    const char* p = (const char*)lv_obj_get_user_data(lv_event_get_target_obj(e));
    app_state::pipeline = p;
    app_state::cloud_pref = strcmp(p, "offline") != 0;
    link_bus::sendPipeline(p);
    ui::toast(p);
  });

  static const char* engV[2] = {"kokoro","piper"};
  static const char* engL[2] = {"Kokoro","Piper"};
  pill_row("Local voice", 152, 2, engV, engL, [](lv_event_t* e){
    const char* eng = (const char*)lv_obj_get_user_data(lv_event_get_target_obj(e));
    app_state::tts_engine = eng;
    link_bus::sendTtsEngine(eng);
    ui::toast(eng);
  });

  lv_obj_t* vlbl2 = lv_label_create(p_set);
  lv_label_set_text(vlbl2, "Voice");
  lv_obj_set_style_text_color(vlbl2, theme::p().muted, 0);
  lv_obj_align(vlbl2, LV_ALIGN_TOP_LEFT, 8, 212);
  lv_obj_t* r = lv_roller_create(p_set);
  lv_roller_set_options(r, "female\nmale", LV_ROLLER_MODE_NORMAL);
  lv_roller_set_visible_row_count(r, 2);
  lv_obj_align(r, LV_ALIGN_TOP_MID, 0, 232);
  lv_roller_set_selected(r, app_state::voice == "male" ? 1 : 0, LV_ANIM_OFF);
  lv_obj_add_event_cb(r, [](lv_event_t* e){
    char buf[16]; lv_roller_get_selected_str(lv_event_get_target_obj(e), buf, sizeof(buf));
    app_state::voice = buf; link_bus::sendVoice(buf);
  }, LV_EVENT_VALUE_CHANGED, nullptr);
}

// ------------------ Page mgmt ------------------
static void hide_all() {
  lv_obj_t* pages[] = {p_splash, p_wifi, p_home, p_chat, p_modes, p_meds, p_music, p_dial, p_sms, p_set};
  for (auto* p : pages) if (p) lv_obj_add_flag(p, LV_OBJ_FLAG_HIDDEN);
}

static void refresh_home() {
  if (!home_mode_lbl) return;
  lv_label_set_text_fmt(home_mode_lbl,    "Mode: %s   Lang: %s",
                        app_state::mode.c_str(), app_state::language.c_str());
  const char* net = app_state::online ? "online" : "offline";
  if (app_state::last_reply_ms > 0) {
    lv_label_set_text_fmt(home_backend_lbl,
                          "pipe:%s  AI:%s [%s]  %dms",
                          app_state::pipeline.c_str(),
                          app_state::backend.c_str(), net,
                          app_state::last_reply_ms);
  } else {
    lv_label_set_text_fmt(home_backend_lbl,
                          "pipe:%s  AI:%s [%s]",
                          app_state::pipeline.c_str(),
                          app_state::backend.c_str(), net);
  }
  if (chat_meta_lbl) {
    if (app_state::last_reply_ms > 0)
      lv_label_set_text_fmt(chat_meta_lbl, "%s \xC2\xB7 %s \xC2\xB7 %d ms",
                            app_state::pipeline.c_str(),
                            app_state::backend.c_str(),
                            app_state::last_reply_ms);
    else
      lv_label_set_text_fmt(chat_meta_lbl, "%s \xC2\xB7 %s",
                            app_state::pipeline.c_str(),
                            app_state::backend.c_str());
  }
  if (chat_avatar) {
    assets::AvatarState st = assets::AvatarState::Idle;
    if      (app_state::speaking)  st = assets::AvatarState::Speak;
    else if (app_state::thinking)  st = assets::AvatarState::Think;
    else if (app_state::listening) st = assets::AvatarState::Listen;
    const char* src = assets::avatar(st);
    if (src) lv_image_set_src(chat_avatar, src);
  }
}

namespace ui {

void begin() {
  Serial.println(F("[tft] begin"));
  tft.begin();
  #ifdef TFT_BL
    pinMode(TFT_BL, OUTPUT);
    digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
  #endif
  tft.setRotation(0);
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_GREEN, TFT_BLACK);
  tft.setTextDatum(TL_DATUM);
  tft.drawString("MindBuddy TFT OK", 8, 8);
  if (TOUCH_CAL[0] || TOUCH_CAL[1] || TOUCH_CAL[2] || TOUCH_CAL[3]) {
    tft.setTouch(TOUCH_CAL);
  }
  Serial.println(F("[tft] initialized"));

  lv_init();
  lv_tick_set_cb((lv_tick_get_cb_t)millis);

  s_disp = lv_display_create(240, 320);
  lv_display_set_flush_cb(s_disp, disp_flush);
  lv_display_set_buffers(s_disp, s_buf1, nullptr, sizeof(s_buf1), LV_DISPLAY_RENDER_MODE_PARTIAL);
  s_indev = lv_indev_create();
  lv_indev_set_type(s_indev, LV_INDEV_TYPE_POINTER);
  lv_indev_set_read_cb(s_indev, touch_read);

  // Mount SD, register LVGL FS driver, load theme.json. Safe to call
  // even if the card isn't present — everything falls back to defaults.
  assets::begin();

  Serial.printf("[ui] heap before build: %u\n", ESP.getFreeHeap());
  build_splash();  Serial.printf("[ui] after splash:   %u\n", ESP.getFreeHeap());
  build_wifi();    Serial.printf("[ui] after wifi:     %u\n", ESP.getFreeHeap());
  build_home();    Serial.printf("[ui] after home:     %u\n", ESP.getFreeHeap());
  disable_shadows(lv_screen_active());

  goTo(Page::Splash);
  app_state::onChange(refresh_home);
}

void tick() { lv_timer_handler(); }

Page current() { return s_current; }

void goTo(Page p) {
  if (p != Page::Splash && p != Page::WifiSetup) s_last = s_current == Page::Home ? Page::Home : s_last;
  s_current = p;
  hide_all();
  lv_obj_t* target = nullptr;
  switch (p) {
    case Page::Splash:    target = p_splash; break;
    case Page::WifiSetup: target = p_wifi;   break;
    case Page::Home:      target = p_home; refresh_home(); break;
    case Page::Chat:      if (!p_chat)  { build_chat();     disable_shadows(p_chat); }  target = p_chat;   break;
    case Page::Modes:     if (!p_modes) { build_modes();    disable_shadows(p_modes); } target = p_modes;  break;
    case Page::Meds:      if (!p_meds)  { build_meds();     disable_shadows(p_meds); }  target = p_meds;   break;
    case Page::Music:     if (!p_music) { build_music();    disable_shadows(p_music); } target = p_music;  break;
    case Page::Dial:      if (!p_dial)  { build_dial();     disable_shadows(p_dial); }  target = p_dial;   break;
    case Page::Sms:       if (!p_sms)   { build_sms();      disable_shadows(p_sms); }   target = p_sms;    break;
    case Page::Settings:  if (!p_set)   { build_settings(); disable_shadows(p_set); }   target = p_set;    break;
    default: break;
  }
  if (target) {
    disable_shadows(target);
    lv_obj_remove_flag(target, LV_OBJ_FLAG_HIDDEN);
  }
  Serial.printf("[ui] goTo page=%d heap=%u\n", (int)p, ESP.getFreeHeap());
}

void back() {
  if (s_current == Page::Home || s_current == Page::Splash || s_current == Page::WifiSetup) return;
  goTo(Page::Home);
}

// -------- chat --------
static void addBubble(const char* text, bool user) {
  if (!chat_list) return;
  lv_obj_t* row = lv_obj_create(chat_list);
  lv_obj_remove_style_all(row);
  lv_obj_set_size(row, lv_pct(100), LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, user ? LV_FLEX_ALIGN_END : LV_FLEX_ALIGN_START,
                        LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
  lv_obj_t* b = lv_obj_create(row);
  lv_obj_set_size(b, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  disable_shadows(b);
  lv_obj_set_style_bg_color(b, user ? theme::p().userBubble : theme::p().aiBubble, 0);
  lv_obj_set_style_radius(b, 0, 0);
  lv_obj_set_style_pad_all(b, 6, 0);
  lv_obj_t* l = lv_label_create(b);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, 180);
  lv_label_set_text(l, text);
  lv_obj_set_style_text_color(l, theme::p().text, 0);
  disable_shadows(row);
  lv_obj_scroll_to_view_recursive(row, LV_ANIM_ON);
}

void chatAppendUser(const char* text) { addBubble(text, true); }
void chatAppendAi  (const char* text) { chatClearPending(); addBubble(text, false); }
void chatSetPending(const char* text) {
  chatClearPending();
  if (!chat_list) return;
  chat_pending = lv_label_create(chat_list);
  lv_label_set_text(chat_pending, text);
  lv_obj_set_style_text_color(chat_pending, theme::p().muted, 0);
}
void chatClearPending() { if (chat_pending) { lv_obj_delete(chat_pending); chat_pending = nullptr; } }

void wifiSetPortalInfo(const char* a, const char* b, const char* c) {
  if (wifi_l1) lv_label_set_text(wifi_l1, a);
  if (wifi_l2) lv_label_set_text(wifi_l2, b);
  if (wifi_l3) lv_label_set_text(wifi_l3, c);
}

void toast(const char* text) {
  lv_obj_t* pop = lv_obj_create(lv_layer_top());
  lv_obj_set_size(pop, 200, 70);
  lv_obj_center(pop);
  lv_obj_set_style_radius(pop, 0, 0);
  lv_obj_set_style_bg_color(pop, theme::p().surface2, 0);
  lv_obj_set_style_bg_opa(pop, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(pop, 1, 0);
  lv_obj_set_style_border_color(pop, theme::p().primary, 0);
  lv_obj_set_style_shadow_width(pop, 0, 0);
  lv_obj_t* l = lv_label_create(pop);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, 180);
  lv_label_set_text(l, text);
  lv_obj_set_style_text_color(l, theme::p().text, 0);
  lv_obj_center(l);
  disable_shadows(pop);
  lv_timer_t* t = lv_timer_create([](lv_timer_t* tm){
    lv_obj_t* o = (lv_obj_t*)lv_timer_get_user_data(tm);
    if (o) lv_obj_delete(o);
    lv_timer_delete(tm);
  }, 1500, pop);
  (void)t;
}

} // namespace ui
