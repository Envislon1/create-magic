#include "ui/ui.h"
#include "config.h"
#include "state.h"
#include "link/link_bus.h"
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>

// ------------------ TFT + Touch ------------------
static TFT_eSPI tft = TFT_eSPI();
static XPT2046_Touchscreen ts(TOUCH_CS);

static lv_display_t* s_disp = nullptr;
static lv_indev_t*   s_indev = nullptr;

static const uint32_t BUF_ROWS = 40;
static lv_color_t s_buf1[240 * BUF_ROWS];
static lv_color_t s_buf2[240 * BUF_ROWS];

static void disp_flush(lv_display_t* d, const lv_area_t* a, uint8_t* px) {
  uint32_t w = a->x2 - a->x1 + 1;
  uint32_t h = a->y2 - a->y1 + 1;
  tft.startWrite();
  tft.setAddrWindow(a->x1, a->y1, w, h);
  tft.pushPixels((uint16_t*)px, w * h);
  tft.endWrite();
  lv_display_flush_ready(d);
}

static void touch_read(lv_indev_t* i, lv_indev_data_t* data) {
  if (ts.tirqTouched() && ts.touched()) {
    TS_Point p = ts.getPoint();
    // XPT2046 raw → 240x320 (portrait). Adjust cal as needed.
    int x = map(p.x, 200, 3900, 0, 240);
    int y = map(p.y, 200, 3900, 0, 320);
    data->point.x = constrain(x, 0, 239);
    data->point.y = constrain(y, 0, 319);
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

// ------------------ Nav bar helper ------------------
static void add_back_btn(lv_obj_t* parent) {
  lv_obj_t* b = lv_button_create(parent);
  lv_obj_set_size(b, 60, 32);
  lv_obj_align(b, LV_ALIGN_TOP_LEFT, 4, 4);
  lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, LV_SYMBOL_LEFT " Back");
  lv_obj_center(l);
  lv_obj_add_event_cb(b, [](lv_event_t*){ ui::back(); }, LV_EVENT_CLICKED, nullptr);
}

// ------------------ Page builders ------------------
static void build_splash() {
  p_splash = lv_obj_create(lv_screen_active());
  lv_obj_remove_style_all(p_splash);
  lv_obj_set_size(p_splash, 240, 320);
  lv_obj_set_style_bg_color(p_splash, lv_color_hex(0x0b3d2e), 0);
  lv_obj_set_style_bg_opa(p_splash, LV_OPA_COVER, 0);

  lv_obj_t* t = lv_label_create(p_splash);
  lv_label_set_text(t, "WUF\nMindBuddy");
  lv_obj_set_style_text_font(t, &lv_font_montserrat_28, 0);
  lv_obj_set_style_text_color(t, lv_color_white(), 0);
  lv_obj_set_style_text_align(t, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(t, LV_ALIGN_CENTER, 0, -30);

  lv_obj_t* code = lv_label_create(p_splash);
  lv_label_set_text_fmt(code, "Code: %s", app_state::device_code.c_str());
  lv_obj_set_style_text_color(code, lv_color_hex(0xbfe7d0), 0);
  lv_obj_align(code, LV_ALIGN_CENTER, 0, 40);

  lv_obj_t* fw = lv_label_create(p_splash);
  lv_label_set_text_fmt(fw, "fw %s", FW_VERSION);
  lv_obj_set_style_text_color(fw, lv_color_hex(0x8fbfa5), 0);
  lv_obj_align(fw, LV_ALIGN_BOTTOM_MID, 0, -8);
}

static void build_wifi() {
  p_wifi = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_wifi, 240, 320);
  lv_obj_set_style_pad_all(p_wifi, 8, 0);

  lv_obj_t* h = lv_label_create(p_wifi);
  lv_label_set_text(h, "Wi-Fi Setup");
  lv_obj_set_style_text_font(h, &lv_font_montserrat_20, 0);
  lv_obj_align(h, LV_ALIGN_TOP_MID, 0, 4);

  wifi_l1 = lv_label_create(p_wifi); lv_label_set_long_mode(wifi_l1, LV_LABEL_LONG_WRAP);
  wifi_l2 = lv_label_create(p_wifi); lv_label_set_long_mode(wifi_l2, LV_LABEL_LONG_WRAP);
  wifi_l3 = lv_label_create(p_wifi); lv_label_set_long_mode(wifi_l3, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(wifi_l1, 220); lv_obj_align(wifi_l1, LV_ALIGN_TOP_LEFT, 4, 44);
  lv_obj_set_width(wifi_l2, 220); lv_obj_align(wifi_l2, LV_ALIGN_TOP_LEFT, 4, 100);
  lv_obj_set_width(wifi_l3, 220); lv_obj_align(wifi_l3, LV_ALIGN_TOP_LEFT, 4, 160);

  ui::wifiSetPortalInfo(
    "1. Join Wi-Fi \"" WM_AP_NAME "\" on your phone",
    "2. Portal opens automatically",
    "3. Pick your network + enter password");
}

static void build_home() {
  p_home = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_home, 240, 320);
  lv_obj_set_style_pad_all(p_home, 6, 0);

  home_status_lbl = lv_label_create(p_home);
  lv_label_set_text(home_status_lbl, "MindBuddy");
  lv_obj_set_style_text_font(home_status_lbl, &lv_font_montserrat_20, 0);
  lv_obj_align(home_status_lbl, LV_ALIGN_TOP_MID, 0, 4);

  home_mode_lbl = lv_label_create(p_home);
  lv_obj_align(home_mode_lbl, LV_ALIGN_TOP_MID, 0, 34);

  home_backend_lbl = lv_label_create(p_home);
  lv_obj_align(home_backend_lbl, LV_ALIGN_TOP_MID, 0, 54);

  // Big Talk button
  lv_obj_t* talk = lv_button_create(p_home);
  lv_obj_set_size(talk, 140, 140);
  lv_obj_align(talk, LV_ALIGN_CENTER, 0, 0);
  lv_obj_set_style_radius(talk, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(talk, lv_color_hex(0x2e8b57), 0);
  lv_obj_t* tl = lv_label_create(talk); lv_label_set_text(tl, LV_SYMBOL_AUDIO "\nTalk");
  lv_obj_set_style_text_align(tl, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_center(tl);
  lv_obj_add_event_cb(talk, [](lv_event_t*){
    link_bus::sendWake(); ui::goTo(ui::Page::Chat);
  }, LV_EVENT_CLICKED, nullptr);

  // Bottom grid: Modes | Meds | Music | Dial | SMS | Settings
  static const char* labels[6] = { "Modes", "Meds", "Music", "Dial", "SMS", "Settings" };
  static const ui::Page pages[6] = {
    ui::Page::Modes, ui::Page::Meds, ui::Page::Music,
    ui::Page::Dial, ui::Page::Sms, ui::Page::Settings
  };
  for (int i = 0; i < 6; ++i) {
    lv_obj_t* b = lv_button_create(p_home);
    lv_obj_set_size(b, 72, 40);
    int col = i % 3, row = i / 3;
    lv_obj_set_pos(b, 6 + col * 76, 210 + row * 46);
    lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, labels[i]); lv_obj_center(l);
    lv_obj_set_user_data(b, (void*)pages[i]);
    lv_obj_add_event_cb(b, [](lv_event_t* e){
      ui::goTo((ui::Page)(intptr_t)lv_obj_get_user_data(lv_event_get_target_obj(e)));
    }, LV_EVENT_CLICKED, nullptr);
  }
}

static void build_chat() {
  p_chat = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_chat, 240, 320);
  lv_obj_set_style_pad_all(p_chat, 4, 0);
  add_back_btn(p_chat);
  lv_obj_t* title = lv_label_create(p_chat);
  lv_label_set_text(title, "Chat");
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 10);

  chat_list = lv_obj_create(p_chat);
  lv_obj_set_size(chat_list, 232, 216);
  lv_obj_align(chat_list, LV_ALIGN_TOP_MID, 0, 44);
  lv_obj_set_flex_flow(chat_list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_scroll_dir(chat_list, LV_DIR_VER);

  chat_meta_lbl = lv_label_create(p_chat);
  lv_label_set_text(chat_meta_lbl, "");
  lv_obj_set_style_text_color(chat_meta_lbl, lv_color_hex(0x8fbfa5), 0);
  lv_obj_align(chat_meta_lbl, LV_ALIGN_BOTTOM_MID, 0, -44);

  lv_obj_t* talk = lv_button_create(p_chat);
  lv_obj_set_size(talk, 90, 34);
  lv_obj_align(talk, LV_ALIGN_BOTTOM_MID, 0, -4);
  lv_obj_t* tl = lv_label_create(talk); lv_label_set_text(tl, LV_SYMBOL_AUDIO " Talk"); lv_obj_center(tl);
  lv_obj_add_event_cb(talk, [](lv_event_t*){ link_bus::sendWake(); }, LV_EVENT_CLICKED, nullptr);
}

static void build_modes() {
  p_modes = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_modes, 240, 320);
  lv_obj_set_style_pad_all(p_modes, 6, 0);
  add_back_btn(p_modes);
  lv_obj_t* title = lv_label_create(p_modes); lv_label_set_text(title, "Support Mode");
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 10);
  lv_obj_t* list = lv_list_create(p_modes);
  lv_obj_set_size(list, 232, 260); lv_obj_align(list, LV_ALIGN_TOP_MID, 0, 44);
  static const char* modes[] = {"ANXIETY","DEPRESSION","PTSD","ADHD","BIPOLAR","SCHIZOPHRENIA","GENERAL"};
  for (auto m : modes) {
    lv_obj_t* it = lv_list_add_button(list, LV_SYMBOL_OK, m);
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
  p_meds = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_meds, 240, 320);
  add_back_btn(p_meds);
  lv_obj_t* t = lv_label_create(p_meds); lv_label_set_text(t, "Medication");
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);
  lv_obj_t* info = lv_label_create(p_meds);
  lv_label_set_long_mode(info, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(info, 220);
  lv_label_set_text(info, "Reminders sync from the web app.\nOpen 'Meds' there to add or edit.");
  lv_obj_align(info, LV_ALIGN_CENTER, 0, 0);
}

static void build_music() {
  p_music = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_music, 240, 320);
  add_back_btn(p_music);
  lv_obj_t* t = lv_label_create(p_music); lv_label_set_text(t, "Music");
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);

  lv_obj_t* np = lv_label_create(p_music); lv_label_set_text(np, "Nothing playing");
  lv_obj_align(np, LV_ALIGN_CENTER, 0, -20);

  static const char* cmds[4] = {"prev","play","pause","next"};
  static const char* syms[4] = {LV_SYMBOL_PREV, LV_SYMBOL_PLAY, LV_SYMBOL_PAUSE, LV_SYMBOL_NEXT};
  for (int i = 0; i < 4; ++i) {
    lv_obj_t* b = lv_button_create(p_music);
    lv_obj_set_size(b, 48, 48);
    lv_obj_set_pos(b, 12 + i * 56, 220);
    lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, syms[i]); lv_obj_center(l);
    lv_obj_set_user_data(b, (void*)cmds[i]);
    lv_obj_add_event_cb(b, [](lv_event_t* e){
      link_bus::sendMusic((const char*)lv_obj_get_user_data(lv_event_get_target_obj(e)));
    }, LV_EVENT_CLICKED, nullptr);
  }
}

static void build_dial() {
  p_dial = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_dial, 240, 320);
  add_back_btn(p_dial);
  lv_obj_t* t = lv_label_create(p_dial); lv_label_set_text(t, "Dial");
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);

  static lv_obj_t* num = lv_textarea_create(p_dial);
  lv_textarea_set_one_line(num, true);
  lv_textarea_set_placeholder_text(num, "+234...");
  lv_obj_set_size(num, 220, 40);
  lv_obj_align(num, LV_ALIGN_TOP_MID, 0, 44);
  lv_obj_add_state(num, LV_STATE_FOCUSED);

  static const char* keys[12] = {"1","2","3","4","5","6","7","8","9","*","0","#"};
  for (int i = 0; i < 12; ++i) {
    lv_obj_t* b = lv_button_create(p_dial);
    lv_obj_set_size(b, 60, 40);
    lv_obj_set_pos(b, 12 + (i % 3) * 72, 96 + (i / 3) * 46);
    lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, keys[i]); lv_obj_center(l);
    lv_obj_set_user_data(b, (void*)keys[i]);
    lv_obj_add_event_cb(b, [](lv_event_t* e){
      lv_textarea_add_text(num, (const char*)lv_obj_get_user_data(lv_event_get_target_obj(e)));
    }, LV_EVENT_CLICKED, nullptr);
  }

  lv_obj_t* call = lv_button_create(p_dial);
  lv_obj_set_size(call, 220, 40);
  lv_obj_align(call, LV_ALIGN_BOTTOM_MID, 0, -4);
  lv_obj_set_style_bg_color(call, lv_color_hex(0x2e8b57), 0);
  lv_obj_t* cl = lv_label_create(call); lv_label_set_text(cl, LV_SYMBOL_CALL " Call"); lv_obj_center(cl);
  lv_obj_add_event_cb(call, [](lv_event_t*){
    // Actual dial handled by modem.cpp — here we just notify link + toast.
    const char* n = lv_textarea_get_text(num);
    if (n && *n) { link_bus::sendCallAnswered(n); ui::toast("Dialing..."); }
  }, LV_EVENT_CLICKED, nullptr);
}

static void build_sms() {
  p_sms = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_sms, 240, 320);
  add_back_btn(p_sms);
  lv_obj_t* t = lv_label_create(p_sms); lv_label_set_text(t, "SMS");
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);
  lv_obj_t* info = lv_label_create(p_sms);
  lv_label_set_long_mode(info, LV_LABEL_LONG_WRAP); lv_obj_set_width(info, 220);
  lv_label_set_text(info, "Incoming SMS shows here.\nCompose via the web app for now.");
  lv_obj_align(info, LV_ALIGN_CENTER, 0, 0);
}

static void build_settings() {
  p_set = lv_obj_create(lv_screen_active());
  lv_obj_set_size(p_set, 240, 320);
  add_back_btn(p_set);
  lv_obj_t* t = lv_label_create(p_set); lv_label_set_text(t, "Settings");
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 10);

  // Volume
  lv_obj_t* vlbl = lv_label_create(p_set); lv_label_set_text(vlbl, "Volume");
  lv_obj_align(vlbl, LV_ALIGN_TOP_LEFT, 8, 40);
  lv_obj_t* v = lv_slider_create(p_set);
  lv_slider_set_range(v, 0, 100); lv_slider_set_value(v, app_state::volume, LV_ANIM_OFF);
  lv_obj_set_size(v, 220, 16); lv_obj_align(v, LV_ALIGN_TOP_MID, 0, 62);
  lv_obj_add_event_cb(v, [](lv_event_t* e){
    int val = lv_slider_get_value(lv_event_get_target_obj(e));
    app_state::volume = val; link_bus::sendVolume(val);
  }, LV_EVENT_VALUE_CHANGED, nullptr);

  // Pipeline: Auto / Online / Offline
  lv_obj_t* plbl = lv_label_create(p_set); lv_label_set_text(plbl, "Pipeline");
  lv_obj_align(plbl, LV_ALIGN_TOP_LEFT, 8, 92);
  lv_obj_t* pipeBtns = lv_obj_create(p_set);
  lv_obj_remove_style_all(pipeBtns);
  lv_obj_set_size(pipeBtns, 224, 34);
  lv_obj_align(pipeBtns, LV_ALIGN_TOP_MID, 0, 110);
  static const char* pipeVals[3] = {"auto", "online", "offline"};
  static const char* pipeLbls[3] = {"Auto", "Online", "Offline"};
  for (int i = 0; i < 3; ++i) {
    lv_obj_t* b = lv_button_create(pipeBtns);
    lv_obj_set_size(b, 70, 30);
    lv_obj_set_pos(b, i * 76, 0);
    lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, pipeLbls[i]); lv_obj_center(l);
    lv_obj_set_user_data(b, (void*)pipeVals[i]);
    lv_obj_add_event_cb(b, [](lv_event_t* e){
      const char* p = (const char*)lv_obj_get_user_data(lv_event_get_target_obj(e));
      app_state::pipeline = p;
      app_state::cloud_pref = strcmp(p, "offline") != 0;
      link_bus::sendPipeline(p);
      ui::toast(p);
    }, LV_EVENT_CLICKED, nullptr);
  }

  // Local TTS engine: Kokoro / Piper
  lv_obj_t* elbl = lv_label_create(p_set); lv_label_set_text(elbl, "Local voice");
  lv_obj_align(elbl, LV_ALIGN_TOP_LEFT, 8, 152);
  lv_obj_t* engBtns = lv_obj_create(p_set);
  lv_obj_remove_style_all(engBtns);
  lv_obj_set_size(engBtns, 224, 34);
  lv_obj_align(engBtns, LV_ALIGN_TOP_MID, 0, 170);
  static const char* engVals[2] = {"kokoro", "piper"};
  static const char* engLbls[2] = {"Kokoro", "Piper"};
  for (int i = 0; i < 2; ++i) {
    lv_obj_t* b = lv_button_create(engBtns);
    lv_obj_set_size(b, 108, 30);
    lv_obj_set_pos(b, i * 112, 0);
    lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, engLbls[i]); lv_obj_center(l);
    lv_obj_set_user_data(b, (void*)engVals[i]);
    lv_obj_add_event_cb(b, [](lv_event_t* e){
      const char* eng = (const char*)lv_obj_get_user_data(lv_event_get_target_obj(e));
      app_state::tts_engine = eng;
      link_bus::sendTtsEngine(eng);
      ui::toast(eng);
    }, LV_EVENT_CLICKED, nullptr);
  }

  // Voice gender
  lv_obj_t* vlbl2 = lv_label_create(p_set); lv_label_set_text(vlbl2, "Voice");
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
}

namespace ui {

void begin() {
  tft.init(); tft.setRotation(0); tft.fillScreen(TFT_BLACK);
  SPI.begin(); ts.begin(); ts.setRotation(0);

  lv_init();
  s_disp = lv_display_create(240, 320);
  lv_display_set_flush_cb(s_disp, disp_flush);
  lv_display_set_buffers(s_disp, s_buf1, s_buf2, sizeof(s_buf1), LV_DISPLAY_RENDER_MODE_PARTIAL);
  s_indev = lv_indev_create();
  lv_indev_set_type(s_indev, LV_INDEV_TYPE_POINTER);
  lv_indev_set_read_cb(s_indev, touch_read);

  build_splash(); build_wifi(); build_home(); build_chat();
  build_modes(); build_meds(); build_music(); build_dial(); build_sms(); build_settings();

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
    case Page::Chat:      target = p_chat;   break;
    case Page::Modes:     target = p_modes;  break;
    case Page::Meds:      target = p_meds;   break;
    case Page::Music:     target = p_music;  break;
    case Page::Dial:      target = p_dial;   break;
    case Page::Sms:       target = p_sms;    break;
    case Page::Settings:  target = p_set;    break;
  }
  if (target) lv_obj_remove_flag(target, LV_OBJ_FLAG_HIDDEN);
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
  lv_obj_set_style_bg_color(b, user ? lv_color_hex(0x2e8b57) : lv_color_hex(0x2b2b2b), 0);
  lv_obj_set_style_radius(b, 10, 0);
  lv_obj_set_style_pad_all(b, 6, 0);
  lv_obj_t* l = lv_label_create(b);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, 180);
  lv_label_set_text(l, text);
  lv_obj_set_style_text_color(l, lv_color_white(), 0);
  lv_obj_scroll_to_view_recursive(row, LV_ANIM_ON);
}

void chatAppendUser(const char* text) { addBubble(text, true); }
void chatAppendAi  (const char* text) { chatClearPending(); addBubble(text, false); }
void chatSetPending(const char* text) {
  chatClearPending();
  if (!chat_list) return;
  chat_pending = lv_label_create(chat_list);
  lv_label_set_text(chat_pending, text);
  lv_obj_set_style_text_color(chat_pending, lv_color_hex(0x888888), 0);
}
void chatClearPending() { if (chat_pending) { lv_obj_delete(chat_pending); chat_pending = nullptr; } }

void wifiSetPortalInfo(const char* a, const char* b, const char* c) {
  if (wifi_l1) lv_label_set_text(wifi_l1, a);
  if (wifi_l2) lv_label_set_text(wifi_l2, b);
  if (wifi_l3) lv_label_set_text(wifi_l3, c);
}

void toast(const char* text) {
  static const char* btns[] = {"OK", ""};
  lv_obj_t* mbox = lv_msgbox_create(nullptr);
  lv_msgbox_add_title(mbox, "");
  lv_msgbox_add_text(mbox, text);
  lv_msgbox_add_footer_button(mbox, "OK");
  (void)btns;
}

} // namespace ui
