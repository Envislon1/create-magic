# Pi ↔ LilyGo UART Protocol (MindBuddy)

**Physical link**
- UART @ 115200 8N1
- Pi 5 pins: GPIO14 TX → LilyGo RX, GPIO15 RX ← LilyGo TX, common GND
- Every message is **one line of JSON terminated by `\n`**. Keep each line under 512 bytes.
- Every message includes `"src"` (`"pi"` or `"lg"`) and `"type"`.

Both sides ignore malformed lines; both sides send `{"type":"ping"}` every 5 s and treat >15 s silence as a link drop.

---

## LilyGo → Pi (control / phone events)

| type | payload | meaning |
|---|---|---|
| `boot` | `{fw:"1.0.0", modem:"A7670"}` | LilyGo just powered on |
| `mode_set` | `{mode:"ANXIETY"}` | User picked a support mode on the TFT |
| `language_set` | `{language:"en"}` | User picked reply language on the TFT (ISO code) |
| `med_set` | `{hour:20,minute:0,enabled:true,label:"..."} ` | Medication reminder edited on TFT |
| `sound_set` | `{enabled:true}` | User toggled speaker |
| `voice_set` | `{voice:"female"}` | Assistant voice |
| `volume_set` | `{volume:70}` | 0–100 |
| `sos_trigger` | `{note:"..."}` | User held SOS. Pi should stop AI, play siren |
| `sos_resolve` | `{}` | User cleared SOS |
| `call_incoming` | `{from:"+2348..."}` | Pi must **release** audio devices |
| `call_answered` | `{from:"+2348..."}` | Pi stays silent, LilyGo owns speaker/mic |
| `call_ended` | `{}` | Pi may resume AI + audio |
| `sms_incoming` | `{from,text}` | Optional Pi TTS read-out |
| `net_status` | `{online:true, rssi:-72, mode:"lte"}` | Pi should switch cloud/local |
| `cloud_toggle` | `{cloud:true}` | Legacy toggle (maps to `pipeline_set` auto/offline) |
| `pipeline_set` | `{pipeline:"auto"\|"online"\|"offline"}` | User picked pipeline on TFT. Pi still falls back to local if cloud fails. |
| `tts_engine_set` | `{engine:"kokoro"\|"piper"}` | Switch local TTS engine live |
| `music_cmd` | `{cmd:"play"\|"pause"\|"next"\|"prev"\|"stop", query?:"..."}` | Music controls from TFT |
| `wake` | `{}` | User tapped "Talk" on TFT |
| `text_prompt` | `{text:"..."}` | User typed a prompt on TFT keyboard |
| `pong` | `{}` | reply to ping |

## Pi → LilyGo (state / chat feed)

| type | payload | meaning |
|---|---|---|
| `boot` | `{fw:"1.0.0", model:"llama-3.2-3b"}` | Pi ready |
| `state` | `{listening,thinking,speaking:bool, backend:"local"\|"cloud", pipeline:"auto"\|"online"\|"offline", tts_engine:"kokoro"\|"piper"\|"cloud"\|"espeak", cloud_ready:bool}` | Drive activity dots + status on TFT |
| `chat_user` | `{text:"..."}` | STT result — LilyGo appends to chat page |
| `chat_ai_delta` | `{text:"..."}` | Streaming token from AI |
| `chat_ai_final` | `{text:"..."}` | Final AI turn (for scrollback) |
| `mode` | `{mode:"ANXIETY"}` | Confirmed from Supabase |
| `language` | `{language:"en"}` | Confirmed reply language |
| `meds` | `{items:[{hour,minute,enabled,label}, ...]}` | Full list after sync |
| `sos_state` | `{active:bool}` | Confirmed |
| `music_state` | `{playing:bool, title:"...", artist:"..."}` | For music page |
| `alarm` | `{kind:"medication", label:"..."}` | LilyGo shows med popup + optional call/SMS |
| `volume` | `{volume:70}` | Reflect back after apply |
| `error` | `{code:"...", msg:"..."}` | Toast on TFT |
| `pong` | `{}` | reply |

---

## Example session

```
LG → PI  {"src":"lg","type":"mode_set","mode":"DEPRESSION"}
PI → LG  {"src":"pi","type":"mode","mode":"DEPRESSION"}
LG → PI  {"src":"lg","type":"wake"}
PI → LG  {"src":"pi","type":"state","listening":true,"thinking":false,"speaking":false}
PI → LG  {"src":"pi","type":"chat_user","text":"i feel low today"}
PI → LG  {"src":"pi","type":"state","listening":false,"thinking":true,"speaking":false}
PI → LG  {"src":"pi","type":"chat_ai_delta","text":"I hear you. "}
PI → LG  {"src":"pi","type":"chat_ai_delta","text":"Would you like a short breathing exercise?"}
PI → LG  {"src":"pi","type":"chat_ai_final","text":"I hear you. Would you like a short breathing exercise?"}
PI → LG  {"src":"pi","type":"state","listening":false,"thinking":false,"speaking":true}
```

## Call precedence

`call_incoming` / `call_answered` are hard preemption. Pi immediately:
1. cancels any playing TTS/music,
2. closes ALSA output + ReSpeaker capture,
3. sends `{"type":"state","listening":false,"thinking":false,"speaking":false,"backend":"..."}`,
4. waits for `call_ended` before re-opening audio.
