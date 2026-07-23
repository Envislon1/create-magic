#ifdef MIND_BUDDY_SMOKE_TEST

#include <Arduino.h>
#include <esp_system.h>

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(LED_BUILTIN, OUTPUT);

  Serial.println();
  Serial.println(F("========================================"));
  Serial.println(F("[smoke] ESP32 DevKit booted"));
  Serial.printf("[smoke] reset_reason=%d\n", (int)esp_reset_reason());
  Serial.printf("[smoke] free_heap=%u\n", (unsigned)ESP.getFreeHeap());
  Serial.println(F("[smoke] LED should toggle once per second"));
  Serial.println(F("========================================"));
}

void loop() {
  static bool on = false;
  static uint32_t last = 0;

  uint32_t now = millis();
  if (now - last >= 1000) {
    last = now;
    on = !on;
    digitalWrite(LED_BUILTIN, on ? HIGH : LOW);
    Serial.printf("[smoke] up=%lus heap=%u led=%s\n",
                  (unsigned long)(now / 1000),
                  (unsigned)ESP.getFreeHeap(),
                  on ? "on" : "off");
  }
}

#endif