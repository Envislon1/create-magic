/* Thin wrapper around TinyGSM. Handles power-on, incoming calls, SMS RX.
   Actual voice audio (mic + earpiece) is routed through the modem's on-board
   codec on the T-A7670G board; the Pi is muted during calls via UART. */
#include "net/modem.h"
#include "config.h"
#include "link/link_bus.h"
#include <TinyGsmClient.h>

namespace modem_mgr {
static HardwareSerial modemSerial(1);   // Serial2 is used by nothing else on S3
static TinyGsm modem(modemSerial);
static bool in_call = false;

static void powerOn() {
  pinMode(MODEM_PWRKEY_PIN, OUTPUT);
  digitalWrite(MODEM_PWRKEY_PIN, LOW); delay(100);
  digitalWrite(MODEM_PWRKEY_PIN, HIGH); delay(1000);
  digitalWrite(MODEM_PWRKEY_PIN, LOW);
  delay(3000);
}

void begin() {
  modemSerial.begin(MODEM_UART_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  powerOn();
  modem.init();
  modem.sendAT("+CLIP=1");   modem.waitResponse();
  modem.sendAT("+CMGF=1");   modem.waitResponse();
  modem.sendAT("+CNMI=2,2,0,0,0"); modem.waitResponse();
}

static void handleLine(const String& line) {
  if (line.startsWith("RING")) {
    // wait for CLIP for caller ID
  } else if (line.startsWith("+CLIP:")) {
    int q1 = line.indexOf('"'), q2 = line.indexOf('"', q1 + 1);
    String from = (q1 > 0 && q2 > q1) ? line.substring(q1 + 1, q2) : "";
    if (!in_call) { in_call = true; link_bus::sendCallIncoming(from.c_str()); }
  } else if (line.startsWith("NO CARRIER") || line.startsWith("BUSY")) {
    if (in_call) { in_call = false; link_bus::sendCallEnded(); }
  } else if (line.startsWith("+CMT:")) {
    int q1 = line.indexOf('"'), q2 = line.indexOf('"', q1 + 1);
    String from = (q1 > 0 && q2 > q1) ? line.substring(q1 + 1, q2) : "";
    // next line = body
    if (modemSerial.available()) {
      String body = modemSerial.readStringUntil('\n'); body.trim();
      link_bus::sendSmsIncoming(from.c_str(), body.c_str());
    }
  }
}

void loop() {
  static String buf;
  while (modemSerial.available()) {
    char c = (char)modemSerial.read();
    if (c == '\n') { buf.trim(); if (buf.length()) handleLine(buf); buf = ""; }
    else if (c != '\r') buf += c;
  }
}

bool dial(const char* number) {
  modem.sendAT(String("D") + number + ";");
  bool ok = modem.waitResponse() == 1;
  if (ok) { in_call = true; link_bus::sendCallAnswered(number); }
  return ok;
}
void hangup() {
  modem.sendAT("H"); modem.waitResponse();
  if (in_call) { in_call = false; link_bus::sendCallEnded(); }
}
bool sendSms(const char* to, const char* text) { return modem.sendSMS(to, text); }
} // namespace
