#pragma once
#include <lvgl.h>

// Theme tokens loaded from /mindbuddy/theme.json on the SD card. If the
// card or the file is missing, defaults matching the MindBuddy TFT Screen
// Pages Figma palette are used, so the firmware always boots.
namespace theme {

struct Palette {
  lv_color_t bg;
  lv_color_t surface;
  lv_color_t surface2;
  lv_color_t primary;
  lv_color_t primaryDim;
  lv_color_t accent;
  lv_color_t danger;
  lv_color_t warn;
  lv_color_t ok;
  lv_color_t text;
  lv_color_t muted;
  lv_color_t userBubble;
  lv_color_t aiBubble;
};

// Load palette from the SD card. Safe to call if SD isn't mounted — falls
// back to compiled-in defaults.
void load();

const Palette& p();
const char* brand();
const char* tagline();

} // namespace theme
