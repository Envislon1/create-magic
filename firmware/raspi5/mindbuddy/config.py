"""Runtime configuration loaded from environment / .env."""
from __future__ import annotations
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

def _s(k: str, d: str = "") -> str: return os.environ.get(k, d) or d
def _i(k: str, d: int) -> int:
    try: return int(os.environ.get(k, d))
    except Exception: return d

@dataclass(frozen=True)
class Config:
    # Pi 5 on Bookworm/Trixie exposes the GPIO14/15 header UART as
    # /dev/ttyAMA10 (ttyAMA0 is the Bluetooth UART). On Pi 4 and earlier
    # override this to /dev/ttyAMA0 (or /dev/serial0) via .env.
    serial_port: str = _s("SERIAL_PORT", "/dev/ttyAMA10")
    serial_baud: int = _i("SERIAL_BAUD", 115200)

    alsa_out: str = _s("ALSA_OUT", "default")
    alsa_in:  str = _s("ALSA_IN",  "default")
    sample_rate: int = _i("SAMPLE_RATE", 16000)

    supabase_url: str = _s("SUPABASE_URL")
    supabase_key: str = _s("SUPABASE_ANON_KEY")
    device_code:  str = _s("DEVICE_CODE")

    local_llm_path: str = _s("LOCAL_LLM_PATH", "./models/llama-3.2-3b-instruct-q4_k_m.gguf")
    local_llm_threads: int = _i("LOCAL_LLM_THREADS", 4)
    local_llm_ctx: int = _i("LOCAL_LLM_CTX", 2048)
    whisper_model: str = _s("WHISPER_MODEL", "./models/ggml-tiny.en.bin")
    # Local TTS: "kokoro" (default, most natural) or "piper" (lighter).
    local_tts_engine: str = _s("LOCAL_TTS_ENGINE", "kokoro").lower()
    kokoro_model:  str = _s("KOKORO_MODEL",  "./models/kokoro/kokoro-v0_19.onnx")
    kokoro_voices: str = _s("KOKORO_VOICES", "./models/kokoro/voices.bin")
    kokoro_voice:  str = _s("KOKORO_VOICE",  "af_heart")
    # Piper fallback / opt-in. Recommended voices:
    #   en_US-lessac-medium (best), en_US-amy-medium, en_GB-alan-medium.
    piper_voice:   str = _s("PIPER_VOICE",   "./models/en_US-lessac-medium.onnx")

    groq_api_key: str = _s("GROQ_API_KEY")
    groq_model:   str = _s("GROQ_MODEL", "llama-3.1-8b-instant")
    openai_api_key: str = _s("OPENAI_API_KEY")
    openai_tts_model: str = _s("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
    openai_tts_voice: str = _s("OPENAI_TTS_VOICE", "alloy")

    wake_phrase: str = _s("WAKE_PHRASE", "hey buddy").lower().strip()
    default_mode: str = _s("DEFAULT_MODE", "ANXIETY")
    default_volume: int = _i("DEFAULT_VOLUME", 70)
    # Pipeline routing: "auto" (cloud when online, local fallback on failure),
    # "online" (force cloud; local only if cloud errors), "offline" (never cloud).
    default_pipeline: str = _s("DEFAULT_PIPELINE", "auto").lower()
    # ISO language code the AI replies in until the user asks otherwise.
    default_language: str = _s("DEFAULT_LANGUAGE", "en").lower()

CFG = Config()
