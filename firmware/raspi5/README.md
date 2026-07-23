# MindBuddy — Raspberry Pi 5 companion service

This runs the audio + AI half of the MindBuddy box on a **Raspberry Pi 5**
(4 GB or 8 GB) with **Raspberry Pi OS Bookworm or Trixie 64-bit** (Debian
12 or 13). The LilyGo 4G LTE board is the master: it owns the TFT UI,
phone calls, SMS and the cellular data link. The Pi handles microphone,
speaker, wake-word, speech-to-text, LLM (local + cloud) and
text-to-speech.

> All shell commands below assume a user named **`mindbuddy`** — the
> default account created by the Raspberry Pi Imager for this build. If
> your account is different (e.g. the classic `pi` user), swap the
> username in the paths and in `systemd/mindbuddy.service` accordingly.

Wire protocol between the two boards is documented in
[`../shared/PROTOCOL.md`](../shared/PROTOCOL.md).

---

## 1. Hardware

| Function | Part | Notes |
|---|---|---|
| Compute | Raspberry Pi 5 (4 GB min, 8 GB recommended for the 3B LLM) | active cooling required — LLM inference pins CPU |
| Microphone | **ReSpeaker 4-Mic Array for Raspberry Pi** (Seeed) | 4-mic linear/circular, on-board VAD + DoA |
| Speaker amp | **MAX98357A I2S** DAC/amp → 4 Ω 3 W speaker | wired to Pi GPIO I2S (see pinout below) |
| Link to LilyGo | UART @ 115200 on GPIO14/15 | + common ground |
| Storage | 64 GB A2 microSD or NVMe hat | LLM weights are ~2 GB |
| Power | 5 V / 5 A USB-C PSU | LTE + LLM together spike current |

### Pinout (BCM numbers)

| Pi pin | Signal | To |
|---|---|---|
| 12 (GPIO18) | I2S BCLK | MAX98357A BCLK |
| 35 (GPIO19) | I2S LRCLK | MAX98357A LRC |
| 40 (GPIO21) | I2S DOUT | MAX98357A DIN |
| 8 (GPIO14) | UART0 TXD | LilyGo RX |
| 10 (GPIO15) | UART0 RXD | LilyGo TX |
| 6 / 9 | GND | LilyGo GND & MAX98357A GND |
| 1 (3V3) | 3.3 V | MAX98357A VIN (or 5 V if your board is 5 V-tolerant) |

The ReSpeaker 4-Mic Array plugs onto the GPIO header — its I2S capture pins
do not clash with the MAX98357A output pins (capture vs. playback are
separate directions on the same I2S peripheral). Its driver adds a
`seeed-4mic-voicecard` ALSA device.

---

## 2. First-time OS setup

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git build-essential cmake pkg-config \
  python3-venv python3-pip python3-dev \
  libasound2-dev portaudio19-dev libatlas-base-dev \
  alsa-utils sox ffmpeg \
  espeak-ng
```

### Enable I2S + UART

`sudo raspi-config` →
- **Interface Options → Serial Port** → login shell **No**, hardware **Yes**
- reboot

Append to `/boot/firmware/config.txt`:

```
dtparam=audio=off
dtparam=i2s=on
dtoverlay=hifiberry-dac      # for MAX98357A output
enable_uart=1
```

Also disable the Bluetooth UART so the header UART is the primary one:

```
dtoverlay=disable-bt
```

Reboot. `aplay -l` should now show the `sndrpihifiberry` card.

**Serial device naming — Pi 5 vs older Pis.** On Raspberry Pi OS
Bookworm/Trixie running on the **Pi 5**, `ls /dev/ttyAMA*` returns two
nodes:

```
/dev/ttyAMA0    ← Bluetooth UART (do NOT use)
/dev/ttyAMA10   ← GPIO14/15 header UART — this is the one wired to LilyGo
```

The `.env.example` and `config.py` defaults already point at
`/dev/ttyAMA10` for that reason. On Pi 4 / 3 / Zero 2 W the header UART
is `/dev/ttyAMA0` (or the stable alias `/dev/serial0`); override
`SERIAL_PORT` in `.env` on those boards.

After `sudo systemctl disable --now hciuart` (recommended so nothing else
grabs the port), confirm the Pi user is in the `dialout` group so it can
open the serial device without sudo:

```bash
sudo usermod -aG dialout,audio,gpio "$USER"
# log out and back in for group changes to apply
```

### ReSpeaker 4-Mic driver

```bash
git clone https://github.com/HinTak/seeed-voicecard.git
cd seeed-voicecard
sudo ./install.sh --compat-kernel
sudo reboot
```

After reboot: `arecord -l` should list `seeed4micvoicec`.

---

## 3. Install the MindBuddy service

```bash
cd ~
git clone <your repo> mindbuddy
cd mindbuddy/firmware/raspi5
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements.txt
```

### Local LLM (llama.cpp + Llama-3.2-3B-Instruct Q4_K_M)

```bash
mkdir -p models && cd models
# ~2.0 GB, runs at ~3-5 tok/s on Pi 5 8GB
wget -O llama-3.2-3b-instruct-q4_k_m.gguf \
  https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf
cd ..
```

### Local STT (whisper.cpp tiny.en)

```bash
cd models
wget -O ggml-tiny.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin
cd ..
```

### Local TTS (Kokoro — default, most natural)

```bash
mkdir -p models/kokoro && cd models/kokoro
wget -O kokoro-v0_19.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v0_19.onnx
wget -O voices.bin        https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices.bin
cd ../..
```

### Local TTS (Piper — optional secondary voice)

Recommended voices, most natural first: `en_US-lessac-medium` ⭐,
`en_US-amy-medium`, `en_GB-alan-medium`, `en_US-ryan-high`,
`en_US-kathleen-low`.

```bash
cd models
wget -O en_US-lessac-medium.onnx      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
wget -O en_US-lessac-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
cd ..
```

The default local engine is **Kokoro**. Switch to Piper live from the
TFT **Settings → Local voice** page, or set `LOCAL_TTS_ENGINE=piper` in
`.env`.

---

## 4. Configure

Copy the sample env and fill in the two Supabase values (same project
your web app uses) plus the pairing code shown on the LilyGo screen the
first time it boots:

```bash
cp .env.example .env
nano .env
```

Required keys:

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | publishable key |
| `DEVICE_CODE` | pairing code from LilyGo splash |
| `GROQ_API_KEY` *(optional)* | enables cloud LLM |
| `OPENAI_API_KEY` *(optional)* | enables cloud TTS |

---

## 5. Run

Foreground for the first boot:

```bash
python -m mindbuddy.main
```

You should see:
```
[audio] out=sndrpihifiberry in=seeed4micvoicec
[llm ] local ready (llama-3.2-3b, 3.8 tok/s)
[link] serial /dev/ttyAMA10 @ 115200 open
[sync] paired to device 0RWX4B, mode=ANXIETY
[ready]
```

### Install as a systemd service

```bash
sudo cp systemd/mindbuddy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mindbuddy
journalctl -u mindbuddy -f
```

---

## 6. Cloud vs local switching

The runtime keeps **local models loaded at all times** so it can answer
even mid-sentence if the LTE link drops. The user picks the pipeline live
from **TFT → Settings → Pipeline**:

- **Auto** (default, recommended) — cloud when `net_status.online == true`
  and a cloud key is present; local fallback if the cloud call errors.
- **Online** — force cloud on every turn; still falls back to local if the
  cloud call errors so the box never goes silent.
- **Offline** — never use cloud, even when online.

The TFT home line shows the currently active backend, network state, and
local voice, e.g. `AI:cloud [online]  voice:kokoro`.

STT is always local (whisper.cpp). Only LLM and TTS have a cloud path.
The local TTS engine (Kokoro / Piper) is also switchable live from
**Settings → Local voice**.

---

## 7. Troubleshooting

- **No sound**: `speaker-test -c2 -tsine -f440 -Dhw:sndrpihifiberry`. If
  silent, check `SD` pin on MAX98357A is not tied low (pull to 3.3 V via
  100 kΩ = mono-mixed left+right).
- **Mic captures silence**: `arecord -Dhw:seeed4micvoicec -f S16_LE -r 16000 -c 4 -d 3 /tmp/t.wav; aplay /tmp/t.wav` — if quiet, run
  `alsamixer` and unmute channels.
- **LLM OOM on 4 GB Pi**: switch to `Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`
  and update `LOCAL_LLM_PATH` in `.env`.
- **Serial silence**: `sudo cat /dev/ttyAMA10` (Pi 5) or
  `sudo cat /dev/ttyAMA0` (Pi 4 and earlier) while the LilyGo is on; you
  should see JSON lines. If nothing, RX/TX are swapped.
- **`Permission denied: '/dev/ttyAMA10'`**: the runtime user is not in
  the `dialout` group. Run `sudo usermod -aG dialout $USER`, log out and
  back in.
- **Only `/dev/ttyAMA0` exists on a Pi 5**: `enable_uart=1` is missing
  from `/boot/firmware/config.txt`, or `dtoverlay=disable-bt` was not
  added. Re-check the config, reboot, then `ls /dev/ttyAMA*` — you must
  see `ttyAMA10`.
