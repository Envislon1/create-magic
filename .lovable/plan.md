# Mind Buddy — voice, wake word, radio, transcription, alerts

Six items, scoped to firmware, local server, cloud server, and web app.

## 1. Nigerian-sounding local TTS

Piper does not ship a first-party Nigerian English voice. I'll wire the local server to a community Nigerian-accent voice and fall back gracefully.

- Add `firmware/local_server/voices/` with an auto-download step in `scripts/postinstall` for one of these (in priority order, first that downloads OK wins):
  1. `en_NG-naija-medium` (community Piper voice, HF mirror)
  2. `en_GB-cori-medium` (closest African-English-friendly fallback)
- New env var `MB_TTS_VOICE` (default `en_NG-naija-medium`) consumed by `firmware/app_local.py` Piper init.
- README: how to drop a custom `.onnx`/`.json` pair into `voices/` to override.

If you'd rather pay for the noticeably better ElevenLabs Nigerian voice instead, say the word and I'll add it as the online path with this Piper voice as offline fallback.

## 2. Always-on "Buddy" wake word + 2-minute conversation window

Use **ESP-SR / WakeNet** (Espressif's on-device keyword spotter, native to ESP32-S3, free, no cloud) with a custom "hi mind buddy" model. Picovoice Porcupine needs a paid AccessKey per device — ESP-SR avoids that.

Firmware (`Healthco2Serial_S3_WakeWord.ino`):
- Replace the current Talk-button start with a continuous ESP-SR detection loop running on core 0.
- State machine:
  - `IDLE` → mic feeds ESP-SR only. Detection triggers `ACTIVE`.
  - `ACTIVE` → `recordPCM()` (already planned) captures utterance via VAD, uploads to `/chat`, plays reply, restarts recording immediately for follow-up.
  - Every reply resets a `lastInteractionMs` timer. If `millis() - lastInteractionMs > 120000` → back to `IDLE` and require wake word again.
- Talk button repurposed: short-press = manual wake (skip wake word once); long-press = force back to `IDLE`.
- OLED shows a small mic icon when armed (wake-word listening) vs. a filled mic when in active conversation, plus a thin countdown bar for the 2-min window.
- README updated with the ESP-SR install line (`idf.py add-dependency "espressif/esp-sr"`) and the wake-word model selection (`hi_mind_buddy`).

If the user prefers cloud wake-word detection instead, I'd stream audio to the local server and run openWakeWord there — say so and I'll switch.

## 3. Radio: just play, then re-tune by voice

- Cloud `firmware/app.py` + local `firmware/app_local.py` + (legacy) `local-server/server.js`: in the action parser, if `play_music` / `play radio` is matched with **no** named station, immediately emit `[[music:random]]` instead of asking. The web AI server-fn `chatWithGuardianAi` already does this — extending parity.
- New intent recogniser: phrases like "change station", "next station", "try another", "switch to <name>", "play <name>" while music is on → emit `[[music:<id-or-random>]]`. The firmware already supports re-tuning mid-playback; just need the server to keep emitting the directive instead of treating it as conversation.

## 4. Smarter transcription (Nigerian-aware)

Two layers, both server-side, no firmware change:

- **Whisper prompt biasing**: pass an `initial_prompt` to Whisper containing common Nigerian terms ("Hausa, Yoruba, Igbo, Edo, Tiv, Ijaw, Fulani, Kanuri, jollof, suya, Naija, Lagos, Abuja, Wazobia, oga, abeg, wahala…"). Massively reduces "ausa"-style drops.
- **LLM repair pass**: before sending the user message to the chat model, run a tiny `correct_transcription` call (same Llama model, low temp, 1–2 sentence system prompt) that fixes obvious phonetic ASR errors using Nigerian-English/pidgin context. Result is logged alongside the raw transcript so we can see what was changed.

Applies to `firmware/app.py`, `firmware/app_local.py`, and `src/lib/guardian-ai.functions.ts`.

## 5. Buzzer chirp at end of every AI statement

The plan in `.lovable/plan.md` item #9 specifies this but it isn't in the .ino yet. Add `playTone(1800, 80)` → 40 ms gap → `playTone(1400, 60)` right after the I2S drain in the TTS-playback path. Skipped only if `gInterrupt` was raised (interrupted replies don't chirp).

## 6. Web app — siren for SOS, distinct chime for medication

- `useAlarmRingtone` already plays a siren — verify it actually fires on the SOS realtime event in `PatientDashboard` / `CaregiverDashboard` (regression check) and surface a one-line warning in the UI if the browser has blocked audio autoplay.
- New `useMedicationChime` hook: 3-note bell pattern (C6–E6–G6, sine wave, 600 ms total) repeating every 4 s for up to 60 s or until dismissed, plus a soft `navigator.vibrate([200,150,200])` pulse. Wired into the existing medication-due path in the dashboard.
- Service worker `sw.js`: new `SHOW_MEDICATION_NOTIFICATION` handler with `tag: "medication-…"`, a softer `vibrate` pattern, and a "Mark taken" notification action.

---

## Files I'll touch

- `firmware/Healthco2Serial_S3_WakeWord/Healthco2Serial_S3_WakeWord.ino` — wake-word loop, 2-min idle timer, talk-button repurpose, end-of-reply chirp (items 2, 5).
- `firmware/Healthco2Serial_S3_WakeWord/README.md` — ESP-SR install + wake-word model docs.
- `firmware/app.py`, `firmware/app_local.py`, `local-server/server.js` — Whisper initial_prompt, LLM repair pass, default-random radio, re-tune intent (items 3, 4).
- `firmware/local_server/scripts/pull-piper-voice.mjs` (new) + `firmware/local_server/package.json` postinstall + `firmware/local_server/README.md` — Nigerian Piper voice (item 1).
- `src/lib/guardian-ai.functions.ts` — same prompt + repair pass for the web chat (item 4).
- `src/hooks/use-medication-chime.ts` (new), `src/components/guardian/PatientDashboard.tsx`, `src/components/guardian/CaregiverDashboard.tsx`, `public/sw.js`, `src/lib/notifications.ts` — medication alert (item 6) + SOS audio regression check.

## What I will NOT change

- Database schema — none of these need new columns.
- Existing radio station catalogue.
- Existing Talk-button hardware wiring (only its software role changes).

Tell me to proceed and I'll implement all six in one pass, or call out any items to drop/split.
