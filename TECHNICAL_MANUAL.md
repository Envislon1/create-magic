# Mind Buddy — Technical Manual

> A portable mental-health companion device + caregiver web app.
> Version 1.0 — June 2026

---

## 1. System Overview

Mind Buddy is a three-tier system:

```
┌────────────────────┐        ┌────────────────────┐        ┌─────────────────────┐
│  ESP32-S3 device   │  ◀────▶│  AI Server (HF)    │  ◀────▶│  Lovable Cloud      │
│  (firmware)        │  HTTPS │  Flask + LLM/STT   │  HTTPS │  Auth, DB, Realtime │
│  mic / speaker /   │        │  /chat /tts /music │        │  Caregiver dashboard │
│  OLED / buttons    │        │  /transcribe /radio│        │  + PWA              │
└────────────────────┘        └────────────────────┘        └─────────────────────┘
```

Two firmware variants ship in this repo:
- `firmware/Healthco2Serial_S3/` — ESP32-S3 (recommended, has PSRAM).
- `firmware/Healthco2Serial/`    — Original ESP32 (legacy).

---

## 2. Device Functions

| # | Function          | How it works                                                                 |
|---|-------------------|------------------------------------------------------------------------------|
| 1 | Tell jokes        | LLM emits `tell_joke` action when user sounds low or asks for one.           |
| 2 | SOS crisis button | Long-press SELECT → POST `/api/public/device/sos` + caregiver SMTP email.    |
| 3 | Music & singing   | LLM emits `play_music` (YouTube via yt-dlp) or `play_radio` (curated streams).|
| 4 | Mood tracker      | Patient dashboard daily check-in stored in `mood_logs` (Lovable Cloud).      |
| 5 | Med reminders     | Local RTC + EEPROM time → speaker prompt + caregiver toast + ringtone.       |
| 6 | Calm exercises    | LLM-guided breathing / grounding prompts (see `MODE_GUIDANCE` in app.py).    |
| 7 | 24/7 AI companion | Push-to-talk → Whisper STT → Llama-3.1-8B LLM → gTTS → speaker.              |

---

## 3. Hardware

### 3.1 ESP32-S3 Pinout

| Pin       | Function                         |
|-----------|----------------------------------|
| GPIO 18   | `BTN_TALK` (push-to-talk, INPUT_PULLUP) |
| GPIO 12   | `BTN_PREV` (INPUT_PULLUP)        |
| GPIO 13   | `BTN_NEXT` (INPUT_PULLUP)        |
| GPIO 14   | `BTN_SELECT` / long-press SOS    |
| I2S0 IN   | INMP441 mic (BCK/WS/SD)          |
| I2S1 OUT  | MAX98357A speaker amp            |
| I2C       | SSD1306 OLED 128×64, DS3231 RTC  |

All buttons are active-LOW with internal pull-ups. ISR-latched on FALLING edge,
debounced both in the ISR (40 ms) and at the dispatcher (250 ms confirm-held).

### 3.2 Required Arduino libraries

Install from **Tools → Manage Libraries…**:

- tzapu **WiFiManager**
- Adafruit **SSD1306**, **GFX**, **RTClib**
- bblanchon **ArduinoJson**
- mobizt **ESP Mail Client** (caregiver SOS email)

---

## 4. Firmware Architecture

### 4.1 Tasks (FreeRTOS)

| Task           | Core | Purpose                                                |
|----------------|------|--------------------------------------------------------|
| `loop()`       | 1    | UI, button dispatch, OLED, RTC tick, med-time check.   |
| `micTask`      | 0    | Push-to-talk capture → STT → chat → TTS.               |
| (HTTP, inline) | 0    | Each HTTPS request runs in the task that needs it.     |

### 4.2 Push-to-talk flow

```
BTN_TALK LOW (debounced 30ms) →
  drain DMA → record 16 kHz mono PCM
  while held (release confirmed when HIGH ≥ 120ms) →
  auto-gain + RMS energy gate (reject silence) →
  POST /transcribe → LLM /chat → speakTextStreamed(reply)
```

`speakTextStreamed()` splits the LLM reply on sentence boundaries
(`. ! ? \n`) into ≤ 180-char chunks. The first chunk is sent to `/tts`
and played immediately while later chunks queue. This drops perceived
TTS latency from ~3-5 s (full reply) to ~1 s (first sentence).

### 4.3 Button debounce rules

| Layer            | Window  | Notes                                                         |
|------------------|---------|---------------------------------------------------------------|
| ISR              | 40 ms   | Per-button rate-limit on FALLING edge.                        |
| Dispatcher       | 250 ms  | Confirm-held + clear residual ISR flags.                      |
| `BTN_TALK` press | 30 ms   | Must read LOW continuously before recording starts.           |
| `BTN_TALK` rel.  | 120 ms  | Must read HIGH continuously before recording stops.           |
| Post-recording   | 80 ms   | HIGH-confirm wait before mic task accepts the next press.     |

The 120 ms release-confirmation fixes the "user cut off mid-sentence" bug
caused by mechanical bounce briefly reading HIGH while the button is held.

### 4.4 EEPROM layout

| Offset | Bytes | Field          |
|--------|-------|----------------|
| 0      | 1     | mode           |
| 1      | 1     | medHour        |
| 2      | 1     | medMinute      |
| 3      | 1     | medEnabled     |
| 4      | 1     | settingIndex   |
| 5      | 1     | soundEnabled   |
| 6      | 1     | voicePref (0=Female,1=Male,2=Neutral,3=Warm) |
| 8..23  | 16    | pairing code   |
| 24..87 | 64    | caregiver email|

### 4.5 Provisioning (WiFiManager captive portal)

1. First boot opens the `MindBuddy-Setup` AP.
2. User joins, picks their home Wi-Fi, types password.
3. Same form collects the 6-char pairing code and caregiver email.
4. All persisted to EEPROM; survives reboot.

---

## 5. AI Server (`firmware/app.py`)

Hugging Face Space running Flask. Endpoints:

| Endpoint           | Method | Purpose                                                |
|--------------------|--------|--------------------------------------------------------|
| `/transcribe`      | POST   | Raw 16 kHz s16le PCM → Whisper-tiny → text.            |
| `/chat`            | POST   | `{message, mode, session_id}` → `{response, action?}`. |
| `/tts`             | POST   | `{text}` → raw 16 kHz s16le PCM (gTTS resampled).      |
| `/music?q=...`     | GET    | yt-dlp + ffmpeg → streamed 16 kHz PCM.                 |
| `/music?q=radio:X` | GET    | Curated public radio stream (see table below).         |
| `/accent/feedback` | POST   | Per-device accent-correction learning.                 |
| `/health`          | GET    | Model + memory status.                                 |

### 5.1 Curated radio stations

| `station`   | Source                          | Mood-fit                  |
|-------------|----------------------------------|---------------------------|
| `lofi`      | Lofi Girl (Zeno.fm)              | focus, restless           |
| `calm`      | SomaFM Drone Zone                | anxious, sad              |
| `ambient`   | SomaFM Deep Space One            | sleep, very anxious       |
| `jazz`      | SomaFM Groove Salad              | upbeat, focus             |
| `classical` | Musopen                          | low energy, sad           |
| `piano`     | Musopen                          | reflective                |
| `news`      | BBC World Service                | explicit user request     |

The LLM picks the station from the mood; the device passes
`play_music?q=radio:<station>` upstream so a single ffmpeg path handles
both YouTube and radio streams.

### 5.2 Server actions emitted by the LLM

```jsonc
{"speak": "...", "action": {"type": "set_medication", "hour": 21, "minute": 0, "enabled": true}}
{"speak": "...", "action": {"type": "play_music",    "query": "afrobeat"}}
{"speak": "...", "action": {"type": "play_radio",    "station": "calm"}}
{"speak": "...", "action": {"type": "stop_music"}}
{"speak": "...", "action": {"type": "tell_joke",     "joke": "Why did the scarecrow..."}}
```

The device honors all of them in `handleServerAction()`
(`firmware/Healthco2Serial_S3/Healthco2Serial_S3.ino`).

### 5.3 Environment variables (HF Space)

| Var          | Purpose                                              |
|--------------|------------------------------------------------------|
| `HF_TOKEN`   | Hugging Face inference token for Llama-3.1-8B chat.  |
| `WEBAPP_BASE`| Optional bridge URL for `/api/public/device/*` POST. |
| `DEVICE_CODE`| Identifies the device when bridging actions upstream.|

System requirements: `yt-dlp` and `ffmpeg` must be on PATH. See
`firmware/requirements.txt`.

---

## 6. Web App (Lovable Cloud + TanStack Start)

### 6.1 Routes

| Path                  | Purpose                                                   |
|-----------------------|-----------------------------------------------------------|
| `/`                   | Public landing page (feature grid, hero, CTA).            |
| `/auth`               | Sign-up / sign-in.                                        |
| `/confirmemail`       | Branded post-signup confirmation prompt.                  |
| `/forgotpassword`     | Branded password-reset request.                           |
| `/reset-password`     | Branded password-reset form.                              |
| `/app`                | Authenticated dashboard. Routes to patient or caregiver.  |
| `/api/public/device/sos`   | Device → app SOS push (no auth, validated by code).  |
| `/api/public/device/sync`  | Device ⇄ app mode + medication sync.                  |

### 6.2 Tables (RLS-protected)

| Table             | Purpose                                                  |
|-------------------|----------------------------------------------------------|
| `user_roles`      | `patient` / `caregiver` (enum, never on profiles table). |
| `pairings`        | Device pairing codes → user mapping.                     |
| `sos_events`      | Crisis alerts from device or app.                        |
| `mood_logs`       | Daily check-ins from patient dashboard.                  |
| `chat_messages`   | Patient ⇄ Mind Buddy AI and patient ⇄ caregiver chat.    |
| `medications`     | Time + enabled flag synced with device.                  |

### 6.3 Server functions

| File                                        | Purpose                                      |
|---------------------------------------------|----------------------------------------------|
| `src/lib/guardian-ai.functions.ts`          | LLM chat via Lovable AI Gateway.             |
| `src/lib/sos.functions.ts`                  | SOS resolve / list / acknowledge.            |
| `src/lib/devices.functions.ts`              | Pair / unpair device.                        |
| `src/lib/sos-email.server.ts`               | Caregiver SMTP fallback notifier.            |

---

## 7. Build & Deploy

### 7.1 Web app

```bash
bun install
bun run dev      # local preview
# Publish from the Lovable editor.
```

### 7.2 Firmware

Open `firmware/Healthco2Serial_S3/Healthco2Serial_S3.ino` in Arduino IDE:

1. Board: **ESP32S3 Dev Module**, PSRAM: **OPI PSRAM**, Flash: **QIO 80 MHz**.
2. Upload speed: 921600.
3. `WEBAPP_BASE` is hard-coded to the published Lovable URL.
4. Click Upload, then open Serial Monitor at 115200 to confirm
   `=== Mind Buddy (ESP32-S3) ===` and `[SPK] welcome` lines.

### 7.3 AI server (HF Space)

```bash
pip install -r firmware/requirements.txt
python firmware/app.py     # local dev on port 7860
```

For production, push `firmware/app.py` + `firmware/requirements.txt` to a
Hugging Face Space (Docker SDK), set `HF_TOKEN` secret.

---

## 8. Troubleshooting

| Symptom                                  | Likely cause / fix                                         |
|------------------------------------------|------------------------------------------------------------|
| Recording cuts off mid-sentence          | Old firmware — flash latest (release-debounce 120 ms).     |
| One tap registers as two recordings      | Old firmware — flash latest (press-debounce 30 ms).        |
| SOS fires on its own                     | Clear ISR flags after `stopSOS()` (already in latest).     |
| TTS lag feels long                       | Verify `speakTextStreamed()` is used in `sendPromptToServer`.|
| Music plays tones instead of a song      | `yt-dlp` / `ffmpeg` missing on server.                     |
| Radio request silent                     | Station not in `RADIO_STATIONS` map; LLM picked unknown.   |
| LLM never offers music or jokes          | Old system prompt — pull latest `app.py`.                  |
| `btnPrevFlag was not declared`           | Add `extern` forward declarations (already in latest).     |
| Captive portal won't open                | Hold SELECT during boot to erase EEPROM Wi-Fi.             |

---

## 9. Security Notes

- `service_role` Supabase key is **only** used server-side
  (`src/integrations/supabase/client.server.ts`). Never expose to client.
- Public device endpoints (`/api/public/device/*`) authenticate by pairing
  code and reject anything else — they never return PII.
- Caregiver SMTP credentials live in Lovable Cloud secrets, never in the
  repo or in firmware.
- Patient roles are stored in a separate `user_roles` table guarded by a
  `has_role()` SECURITY DEFINER function (no client-side role checks).

---

## 10. Change Log

- **v1.0 (June 2026)** — Mind Buddy rebrand from WUF; added curated radio
  streams; AI knows about jokes and music; talk button debounce;
  sentence-streamed TTS; ESP32-S3 firmware split; caregiver dashboard;
  branded auth email templates.
