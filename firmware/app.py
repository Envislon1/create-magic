from flask import Flask, request, jsonify, send_file, Response
import torch
from transformers import pipeline
from huggingface_hub import InferenceClient
import os
import re
import json
import logging
import io
import numpy as np
from pydub import AudioSegment
import gc
import psutil
import threading
import time
import uuid
import tempfile
import atexit
import urllib.request
from collections import OrderedDict

# =========================================================
# LOGGING
# =========================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =========================================================
# ENVIRONMENT
# =========================================================
IS_HF_SPACE = os.environ.get('SPACE_ID') is not None
HF_TOKEN = os.environ.get('HF_TOKEN')

# Optional Mind Buddy App webapp bridge.
# If set, /chat will forward set_medication actions and an explicit
# {"type":"sos"} message to the webapp's public device endpoints so the
# user's phone gets a notification even when the action originates from
# voice instead of a hardware button.
WEBAPP_BASE = os.environ.get('WEBAPP_BASE', '').rstrip('/')
DEVICE_CODE = os.environ.get('DEVICE_CODE', '')

def webapp_post(path, payload):
    if not WEBAPP_BASE or not DEVICE_CODE:
        return
    try:
        req = urllib.request.Request(
            f"{WEBAPP_BASE}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Device-Code": DEVICE_CODE,
            },
            method="POST",
        )
        urllib.request.urlopen(req, timeout=6).read()
    except Exception as e:
        logger.warning(f"webapp bridge failed {path}: {e}")

if IS_HF_SPACE:
    device = -1
    torch.set_num_threads(2)
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    logger.info("Running on Hugging Face Spaces")
else:
    device = 0 if torch.cuda.is_available() else -1
    torch.set_num_threads(4)

logger.info(f"Using device: {'cuda' if device == 0 else 'cpu'}")

# =========================================================
# FLASK
# =========================================================
app = Flask(__name__)
app.config['TEMP_AUDIO_DIR'] = '/tmp/audio_responses'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# =========================================================
# GLOBALS
# =========================================================
stt_pipeline = None
hf_client = None
tts_type = None
active_files = {}
file_cleanup_lock = threading.Lock()
cleanup_thread = None

# =========================================================
# FILE CLEANUP
# =========================================================
def cleanup_old_files():
    while True:
        try:
            with file_cleanup_lock:
                current_time = time.time()
                to_remove = []
                for fid, info in list(active_files.items()):
                    if current_time - info['created_time'] > 300:
                        to_remove.append(fid)
                for fid in to_remove:
                    try:
                        fp = active_files[fid]['filepath']
                        if os.path.exists(fp):
                            os.remove(fp)
                        del active_files[fid]
                    except Exception as e:
                        logger.warning(f"Cleanup error: {e}")
        except Exception as e:
            logger.error(f"Cleanup thread error: {e}")
        time.sleep(60)

def start_cleanup_thread():
    global cleanup_thread
    if cleanup_thread is None or not cleanup_thread.is_alive():
        cleanup_thread = threading.Thread(target=cleanup_old_files, daemon=True)
        cleanup_thread.start()
        logger.info("Cleanup thread started")

def cleanup_all_files():
    try:
        with file_cleanup_lock:
            for fid, info in active_files.items():
                try:
                    if os.path.exists(info['filepath']):
                        os.remove(info['filepath'])
                except Exception:
                    pass
            active_files.clear()
    except Exception as e:
        logger.warning(f"Final cleanup error: {e}")
atexit.register(cleanup_all_files)

def get_memory_usage():
    try:
        process = psutil.Process(os.getpid())
        return {
            "rss_mb": process.memory_info().rss / 1024 / 1024,
            "percent": psutil.virtual_memory().percent
        }
    except Exception:
        return {"rss_mb": 0, "percent": 0}

# =========================================================
# MODEL INIT
# =========================================================
def initialize_models():
    global stt_pipeline, hf_client, tts_type
    logger.info("Initializing models...")

    if stt_pipeline is None:
        logger.info("Loading Whisper Tiny")
        stt_pipeline = pipeline(
            "automatic-speech-recognition",
            model="openai/whisper-tiny",
            device=-1
        )
        logger.info("Whisper Ready")

    if hf_client is None:
        if not HF_TOKEN:
            logger.warning("HF_TOKEN missing")
        else:
            hf_client = InferenceClient(api_key=HF_TOKEN)
            logger.info("HF Client Ready")

    try:
        from gtts import gTTS  # noqa: F401
        tts_type = "gtts"
        logger.info("gTTS Ready")
    except Exception as e:
        logger.warning(f"TTS Error: {e}")
        tts_type = "silent"

    start_cleanup_thread()
    logger.info("All Systems Ready")

# =========================================================
# CONVERSATION MEMORY
# =========================================================
conversation_history = {}

SYSTEM_PROMPT = """
You are Mind Buddy, a warm, emotionally aware mental-health companion who
listens to and supports the user through a small wearable device. You speak
like a trusted friend: gentle, patient, present, and unhurried.

IDENTITY RULES (STRICT):
- Never describe yourself as an AI, a chatbot, a language model, a program,
  a machine, a bot, a virtual assistant, or "just" anything.
- Never use the word "AI" in any reply.
- If the user asks "are you a robot / an AI / a program / who are you",
  reply warmly as their companion (e.g. "I'm Mind Buddy, your companion. I'm
  here for you whenever you need me.") and gently move the conversation back
  to how they are feeling. Do not confirm or deny being software.
- Never say things like "I cannot feel", "I do not have feelings",
  "I was created by", "I'm only here to help you with X". Stay in character
  as a caring companion.

LANGUAGE AND TONE (STRICT - CLEAR ENGLISH ONLY):
- Always reply in clear, simple English that is warm, respectful, and easy for
  text-to-speech to pronounce.
- Understand Nigerian English or Pidgin English if the user speaks that way,
  but DO NOT reply in Pidgin English.
- Do not use phrases such as "abeg", "wahala", "I dey", "no vex", "small small",
  "how far", "take am easy", or similar Pidgin expressions.
- If the user's message is empty, gibberish, noise, or not understandable,
  reply EXACTLY: "Sorry, I didn't catch that. Please say it again in English."
  and DO NOT emit any action.

ANTI-STIGMA SAFETY RULES:
- Never name, label, diagnose, or remind the user of a mental-health condition.
- Do not say phrases like "your PTSD", "your depression", "your schizophrenia",
  "as someone with ADHD", or "how long have you been coping with...".
- If internal support guidance is provided, use it only to choose a helpful tone
  and coping strategy. Never reveal the label or discuss it as the user's identity.
- Ask about the user's current feeling, need, or situation instead of their diagnosis.

You can also help the user CONTROL the device. The device understands these
actions:

  set_medication  -> change daily medication reminder time
                     fields: hour (0-23), minute (0-59), enabled (bool)
  play_music      -> play a specific song / artist / genre on demand
                     field: query (string, e.g. "afrobeat", "Adele Hello")
  play_radio      -> start a curated 24/7 internet radio stream that suits
                     the user's mood. Use this when the user wants
                     background music, calm sounds, or you proactively
                     offer music to lift their mood.
                     field: station (one of: lofi, calm, jazz, classical,
                            piano, ambient, news)
                     suggested mapping by mood:
                       low / sad           -> "calm" or "piano"
                       anxious / stressed  -> "calm" or "ambient"
                       restless / focus    -> "lofi" or "jazz"
                       neutral / upbeat    -> "lofi" or "jazz"
                       wants the news      -> "news"
  stop_music      -> stop currently playing music or radio
  tell_joke       -> tell a funny, lighthearted, clean joke, humorous story, or
                     playful anecdote designed to improve the user's mood.
                     field: joke (3-8 sentences, containing the complete joke
                     or story).

                     Prefer situational humor, misunderstandings, clever
                     observations, everyday life experiences, family moments,
                     technology mishaps, school/work situations, or funny
                     conversations between characters.

                     The joke may be delivered as a short story with a setup,
                     buildup, and punchline. Use expressive and conversational
                     language rather than one-line jokes.

                     If the user explicitly requests Nigerian humor, Pidgin,
                     local references, or a specific style, adapt the joke
                     accordingly while keeping it understandable, friendly, and
                     inclusive.

                     Humor should remain positive, warm, and suitable for all
                     ages. Never generate offensive, discriminatory, political,
                     religious, sexual, graphic, humiliating, or dark humor.
                     Avoid mocking real individuals or vulnerable groups.

                     When appropriate, you may proactively offer a joke if the
                     user sounds bored, stressed, disappointed, or asks to be
                     entertained.

JOKES & MOOD-AWARE BEHAVIOR:
- You can tell jokes. If the user sounds sad, flat, or bored, you may gently
  ask "would you like to hear a quick joke?" before emitting tell_joke.
- If the user asks "tell me a joke" / "make me laugh" / "cheer me up",
  emit a tell_joke action immediately.
- Keep humour gentle and family-friendly.

MUSIC AWARENESS:
- Music is one of your core functions. Treat it as an emotional tool, not
  just a request. If the user is anxious, sad, or restless, you may offer
  music ("would you like some calm music while we talk?") before emitting
  play_radio.
- RADIO RULE (STRICT): If the user asks to play radio, music, or a song
  WITHOUT naming a specific station or genre, NEVER ask them what to play.
  Immediately pick a soothing station yourself and emit play_radio with a
  brief spoken announcement (e.g. "Playing some calm music for you.").
- If the user then says "switch station", "change it", "try another",
  "next station", "different one", "I don't like this", pick a DIFFERENT
  station from the catalogue and emit play_radio again. Keep tuning by
  voice command until they're happy. Never ask them to specify unless
  they explicitly mention a genre you can't infer.

RULES FOR ACTIONS:
- Only emit an action when the user CLEARLY asks for it, or when you have
  asked permission first ("want me to play something calm?") and they said yes.
- When you emit an action, your reply MUST be valid JSON in EXACTLY this
  shape and nothing else:
    {"speak": "<short spoken confirmation>", "action": {"type": "...", ...}}
- When NO action is needed, reply with PLAIN TEXT only (no JSON, no braces).
- Keep spoken replies short (1-2 sentences) - they go through a small speaker.
- Never invent times. If the user did not specify minute, use 0.
- For play_music, put the user's request verbatim into "query".

Examples:
User: "Set my medication time to 9 pm"
Reply: {"speak":"Okay, medication set to 9 PM.","action":{"type":"set_medication","hour":21,"minute":0,"enabled":true}}

User: "Turn off my pill reminder"
Reply: {"speak":"Medication reminder turned off.","action":{"type":"set_medication","hour":0,"minute":0,"enabled":false}}

User: "Play some afrobeat"
Reply: {"speak":"Playing some afrobeat for you.","action":{"type":"play_music","query":"afrobeat"}}

User: "I feel really anxious"
Reply: {"speak":"Let's breathe together. I'll play something calm in the background.","action":{"type":"play_radio","station":"calm"}}

User: "Tell me a joke"
Reply: {"speak":"Here's one for you.","action":{"type":"tell_joke","joke":"Why did the scarecrow win an award? Because he was outstanding in his field."}}

User: "I'm feeling anxious tonight"
Reply: I hear you. Want to try a slow breath together, or just talk through what's on your mind?
"""

MODE_GUIDANCE = {
    "ANXIETY": (
        "Anxiety-disorder mode (panic, GAD, social anxiety, stress). Blend "
        "psychotherapist + counselor. Slow the pace. On panic, guide box "
        "breathing (4-4-4-4) or paced breathing (inhale 4, exhale 6) and "
        "remind them the wave will pass. For rumination offer worry-"
        "postponement or one small next step. For social anxiety normalise "
        "and suggest a tiny exposure step. Encourage 5-4-3-2-1 grounding, "
        "hydration, sleep, sunlight. Do not name a diagnosis."
    ),
    "DEPRESSION": (
        "Depression mode. Blend clinical-psychologist warmth + social-worker "
        "encouragement. Validate low energy in one sentence before anything "
        "else. Offer a gentle 0-10 mood check. Give ONE tiny concrete step "
        "for the next 10 minutes (window open, water, 60 seconds outside). "
        "If hopelessness or self-harm surfaces, respond with warmth, remind "
        "them help exists, and offer to trigger SOS. Do not name a diagnosis."
    ),
    "PTSD": (
        "Trauma-informed mode. Extra gentle, extra slow. Never ask the user "
        "to describe the trauma; never repeat traumatic content back. Lead "
        "with grounding (5-4-3-2-1, feet on the floor, cool water, anchor "
        "object). Orient to present safety ('you are safe right now, it is "
        "[time]'). Offer safe-place visualisation, paced breathing, butterfly "
        "hug. Encourage staying connected with their therapist. Do not name "
        "a diagnosis."
    ),
    "ADHD": (
        "ADHD support mode. Blend coach + counselor + OT. Keep replies "
        "PUNCHY (1-2 sentences). Turn vague tasks into a 2-minute starter. "
        "Offer a Pomodoro (25/5), body-doubling, or 'brain-dump then pick "
        "one'. Anchor new habits to existing ones. Celebrate tiny wins. "
        "Do not name a diagnosis."
    ),
    "BIPOLAR": (
        "Bipolar wellness mode. Blend counselor + psychiatric-nurse check-in "
        "style. Steady, non-alarming. Ask a quick 0-10 mood + energy + sleep "
        "check. Remind about medication ONLY at the user-set time; never "
        "change a dose. If you notice possible hypomanic signs (little "
        "sleep + racing plans + big spending) or a depressive dip, kindly "
        "suggest they contact their prescriber and offer to help draft "
        "what to say. Do not name a diagnosis."
    ),
    "SCHIZOPHRENIA": (
        "Psychosis-spectrum support mode. Blend psychiatric-nurse steadiness "
        "+ social-worker warmth. Stay concrete, present-tense, non-"
        "judgemental. Reality-orient gently (day, time, place) — never argue "
        "with a hallucination, never confirm it as real. Redirect to the "
        "shared present. Remind about medication ONLY at the user-set time; "
        "if a dose is missed, encourage contacting their prescriber rather "
        "than 'doubling up'. Quiet the sensory load (low voice, slow "
        "breathing). Encourage caregiver involvement. Do not name a diagnosis."
    ),
    "GENERAL": (
        "General companion mode. Warm friend + counselor. Meet the user "
        "where they are; offer one small helpful step. Do not name a diagnosis."
    ),
}

# Language names for the reply-language directive.
_LANG_NAMES = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German",
    "pt": "Portuguese", "it": "Italian", "ha": "Hausa", "yo": "Yoruba",
    "ig": "Igbo", "sw": "Swahili", "ar": "Arabic", "hi": "Hindi",
    "zh": "Mandarin Chinese", "ru": "Russian", "ja": "Japanese", "ko": "Korean",
}

def language_directive(lang_code):
    name = _LANG_NAMES.get(str(lang_code or "en").lower(), "English")
    return (
        f"LANGUAGE: Reply in {name}. Keep every other rule identical, but "
        f"write the spoken sentences in {name}. Stay in {name} for every "
        f"turn UNLESS the user explicitly asks to switch to another language, "
        f"then switch and stay in the new language until they change again. "
        f"Emotion tags and JSON action tags stay in ASCII."
    )

def build_mode_context(mode):
    guidance = MODE_GUIDANCE.get(str(mode or "").upper())
    if not guidance:
        return MODE_GUIDANCE["GENERAL"]
    return guidance

def sanitize_spoken_reply(text):
    """Defensive cleanup so TTS never speaks Pidgin or diagnosis labels."""
    cleaned = text or ""
    for phrase, replacement in PIDGIN_REPLACEMENTS.items():
        cleaned = re.sub(re.escape(phrase), replacement, cleaned, flags=re.IGNORECASE)
    for phrase, replacement in CONDITION_REPLACEMENTS.items():
        cleaned = re.sub(rf"\b{re.escape(phrase)}\b", replacement, cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "I'm here with you. What would help most right now?"

def generate_llm_response(text, session_id="default", mode="GENERAL", language="en"):
    try:
        if not hf_client:
            return "I'm here with you. Tell me a little more about what's on your mind.", None

        if session_id not in conversation_history:
            conversation_history[session_id] = []

        conversation_history[session_id].append(
            {"role": "user", "content": text}
        )
        if len(conversation_history[session_id]) > 10:
            conversation_history[session_id] = conversation_history[session_id][-10:]

        system_content = (
            SYSTEM_PROMPT
            + f"\nPrivate support guidance: {build_mode_context(mode)}"
            + f"\n{language_directive(language)}"
        )
        messages = [{"role": "system", "content": system_content}]
        messages.extend(conversation_history[session_id])

        completion = hf_client.chat_completion(
            model="meta-llama/Llama-3.1-8B-Instruct",
            messages=messages,
            max_tokens=220,
            temperature=0.8,
            top_p=0.95
        )
        raw = completion.choices[0].message.content.strip()

        # Try to parse action JSON
        action = None
        spoken = raw
        parsed = _try_parse_action(raw)
        if parsed:
            spoken = parsed.get("speak") or "Done."
            action = parsed.get("action")
        spoken = sanitize_spoken_reply(spoken)

        conversation_history[session_id].append(
            {"role": "assistant", "content": spoken}
        )
        return spoken, action

    except Exception as e:
        logger.error(f"LLM Error: {e}")
        return "I'm listening. Could you say that again in a different way?", None

def _try_parse_action(text):
    """Return dict if text is the action-JSON envelope, else None."""
    t = text.strip()
    if not (t.startswith("{") and t.endswith("}")):
        # try to extract first {...} block
        m = re.search(r"\{.*\}", t, re.DOTALL)
        if not m:
            return None
        t = m.group(0)
    try:
        obj = json.loads(t)
        if isinstance(obj, dict) and "action" in obj and isinstance(obj["action"], dict):
            act = obj["action"]
            if act.get("type") in ("set_medication", "play_music", "play_radio", "stop_music", "tell_joke", "play_sd_music"):
                return obj
    except Exception:
        return None
    return None

# =========================================================
# AUDIO PREPROCESS
# =========================================================
def preprocess_audio(audio_bytes):
    try:
        if len(audio_bytes) > 44 and audio_bytes[:4] == b'RIFF':
            audio_bytes = audio_bytes[44:]
        audio_data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if len(audio_data) < int(0.3 * 16000):
            return None, None
        return 16000, audio_data
    except Exception as e:
        logger.error(f"Audio error: {e}")
        return None, None

_WHISPER_HALLUCINATIONS = {
    "thank you", "thank you.", "thank you very much",
    "thank you very much.", "thanks", "thanks.",
    "thanks for watching", "thanks for watching.",
    "thanks for watching!", "thank you for watching",
    "thank you for watching.", "you", "you.", "...",
    ".", "bye", "bye.", "goodbye", "goodbye.",
    "you're welcome", "you're welcome.", "i love you",
    "i love you.", "okay", "okay.", "ok", "ok.",
    "yeah", "yeah.", "hmm", "uh", "oh", "oh.",
    "please subscribe", "subscribe", "music", "music.",
    "applause", "[music]", "[applause]",
}

def is_probably_english(text):
    """Reject Whisper-tiny silence/noise hallucinations."""
    t = (text or "").strip()
    if len(t) < 2:
        return False
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return False
    ascii_letters = [c for c in letters if ord(c) < 128]
    if len(ascii_letters) / len(letters) < 0.9:
        return False
    words = re.findall(r"[A-Za-z']+", t.lower())
    if not words:
        return False
    # pure repetition like "you you you"
    if len(set(words)) == 1 and len(words) > 2:
        return False
    if t.lower().strip(" .!?,") in _WHISPER_HALLUCINATIONS:
        return False
    if t.lower() in _WHISPER_HALLUCINATIONS:
        return False
    return True

# Nigerian-context vocabulary so Whisper doesn't drop the H in "Hausa",
# the I in "Igbo", etc. Prepended to every initial_prompt as a soft bias.
NAIJA_BIAS = (
    "Conversation with a Nigerian English speaker. Likely words: Hausa, Yoruba, "
    "Igbo, Edo, Tiv, Ijaw, Fulani, Kanuri, Efik, Ibibio, jollof, suya, egusi, "
    "akara, Naija, Lagos, Abuja, Ibadan, Kano, Port Harcourt, Wazobia, oga, "
    "abeg, wahala, sabi, chai, abi, jare, biko."
)

def _build_initial_prompt(session_id):
    """Use the user's recent corrected examples as a Whisper initial_prompt.
    Whisper conditions its decoder on this text, biasing it toward the
    user's vocabulary + accent patterns. Costs nothing per call. Always
    prepends a Nigerian-vocabulary hint so common terms aren't dropped."""
    try:
        with ACCENT_LOCK:
            profile = _load_accent_profile(session_id or "default")
            examples = list(profile.get("examples") or [])
        # Always include the Nigerian bias, even when no per-user examples exist.
        hint = NAIJA_BIAS
        if examples:
            user_hint = " ".join(
                e["corrected"] for e in examples[-6:] if e.get("corrected")
            ).strip()
            if user_hint:
                hint = (hint + " " + user_hint).strip()
        # Whisper's prompt context is capped — keep it short.
        return hint[:240] if hint else None
    except Exception:
        return NAIJA_BIAS

def transcribe_bytes(audio_bytes, session_id=None):
    rate, audio = preprocess_audio(audio_bytes)
    if audio is None:
        return ""
    # Reject low-energy clips before Whisper sees them — these are what
    # produce "Thank you very much" hallucinations.
    rms = float(np.sqrt(np.mean(audio * audio))) if len(audio) else 0.0
    if rms < 0.010:
        logger.info(f"Rejected low-energy clip (rms={rms:.4f})")
        return ""
    gen_kwargs = {
        "language": "english",
        "task": "transcribe",
        "no_repeat_ngram_size": 3,
        "temperature": 0.0,
    }
    initial_prompt = _build_initial_prompt(session_id)
    if initial_prompt:
        gen_kwargs["initial_prompt"] = initial_prompt
    result = stt_pipeline(
        {"sampling_rate": rate, "raw": audio},
        generate_kwargs=gen_kwargs,
    )
    text = (result.get("text") or "").strip()
    if not is_probably_english(text):
        logger.info(f"Filtered hallucination: {text!r}")
        return ""
    return text

# =========================================================
# ACCENT LEARNING LAYER
# ---------------------------------------------------------
# Per-session adaptive transcription correction. Every device has its own
# accent profile (keyed by X-Session-Id / pairing code). The profile is a
# tiny on-disk JSON file with two things:
#
#   substitutions: { "<raw phrase>": "<corrected phrase>", ... }
#                  Applied as case-insensitive whole-word/phrase rewrites
#                  every time we transcribe. This makes recurring accent
#                  mis-hears get fixed automatically without any model
#                  fine-tuning.
#
#   examples:      [{ "raw": "...", "corrected": "..." }, ...]
#                  Kept as few-shot context. Once we have >= 3 examples
#                  for a session we also ask the LLM to rewrite the raw
#                  Whisper output using those examples as a style/accent
#                  reference, which catches novel phrasings the static
#                  substitution table can't.
#
# Storage path is /tmp on HF Spaces; that is intentionally ephemeral —
# the profile rebuilds itself within minutes of use. For durable storage
# across container restarts, point ACCENT_DIR at a persistent volume.
# =========================================================
ACCENT_DIR = os.environ.get("ACCENT_DIR", "/tmp/accent_profiles")
os.makedirs(ACCENT_DIR, exist_ok=True)
ACCENT_LOCK = threading.Lock()
_accent_cache = OrderedDict()  # session_id -> profile dict (LRU)
_ACCENT_CACHE_CAP = 64
_MAX_SUBSTITUTIONS = 64
_MAX_EXAMPLES = 12

def _accent_path(session_id):
    safe = re.sub(r"[^A-Za-z0-9_\-]", "_", session_id or "default")[:40] or "default"
    return os.path.join(ACCENT_DIR, f"{safe}.json")

def _load_accent_profile(session_id):
    if session_id in _accent_cache:
        _accent_cache.move_to_end(session_id)
        return _accent_cache[session_id]
    path = _accent_path(session_id)
    profile = {"substitutions": {}, "examples": []}
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f) or {}
            if isinstance(loaded.get("substitutions"), dict):
                profile["substitutions"] = {
                    str(k): str(v) for k, v in loaded["substitutions"].items()
                }
            if isinstance(loaded.get("examples"), list):
                profile["examples"] = [
                    {"raw": str(e.get("raw", "")), "corrected": str(e.get("corrected", ""))}
                    for e in loaded["examples"]
                    if isinstance(e, dict) and e.get("raw") and e.get("corrected")
                ][-_MAX_EXAMPLES:]
    except Exception as e:
        logger.warning(f"accent load failed for {session_id}: {e}")
    _accent_cache[session_id] = profile
    if len(_accent_cache) > _ACCENT_CACHE_CAP:
        _accent_cache.popitem(last=False)
    return profile

def _save_accent_profile(session_id, profile):
    try:
        path = _accent_path(session_id)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(profile, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception as e:
        logger.warning(f"accent save failed for {session_id}: {e}")

def _apply_substitutions(text, substitutions):
    if not text or not substitutions:
        return text
    out = text
    # Apply longer keys first so multi-word phrases win over single words.
    for raw in sorted(substitutions.keys(), key=len, reverse=True):
        if not raw.strip():
            continue
        corrected = substitutions[raw]
        pattern = r"\b" + re.escape(raw) + r"\b"
        try:
            out = re.sub(pattern, corrected, out, flags=re.IGNORECASE)
        except re.error:
            continue
    return out

def _llm_accent_refine(raw_text, examples):
    """Use the LLM as a soft accent corrector, primed with the user's own
    past corrections. Falls back to raw_text on any error so this layer
    can never break transcription."""
    if not hf_client or not raw_text or len(examples) < 3:
        return raw_text
    try:
        few_shot = "\n".join(
            f"- raw: {e['raw']!r}\n  corrected: {e['corrected']!r}"
            for e in examples[-_MAX_EXAMPLES:]
        )
        sys = (
            "You are an accent-aware transcription corrector. The user speaks "
            "English with a regional accent. Given a raw automatic transcript, "
            "return a cleaner English version that preserves the user's intent "
            "exactly. Do NOT add information. Do NOT translate. Only fix likely "
            "mis-hears using the user's own correction history below as a guide. "
            "Reply with ONLY the corrected sentence, no quotes, no commentary.\n\n"
            f"Correction history for this user:\n{few_shot}"
        )
        completion = hf_client.chat_completion(
            model="meta-llama/Llama-3.1-8B-Instruct",
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": f"raw: {raw_text}\ncorrected:"},
            ],
            max_tokens=80,
            temperature=0.1,
            top_p=0.9,
        )
        refined = (completion.choices[0].message.content or "").strip()
        # Strip any quoting/labels the model may have added.
        refined = re.sub(r'^["\']|["\']$', "", refined).strip()
        if refined.lower().startswith("corrected:"):
            refined = refined.split(":", 1)[1].strip()
        # Sanity guard: never let the LLM balloon a 3-word sentence into a
        # paragraph or shrink it to nothing.
        if not refined or len(refined) > max(40, 3 * len(raw_text)):
            return raw_text
        return refined
    except Exception as e:
        logger.warning(f"accent refine failed: {e}")
        return raw_text

def apply_accent_layer(session_id, raw_text):
    if not raw_text or not session_id:
        return raw_text
    with ACCENT_LOCK:
        profile = _load_accent_profile(session_id)
        subs = dict(profile.get("substitutions") or {})
        examples = list(profile.get("examples") or [])
    stepped = _apply_substitutions(raw_text, subs)
    refined = _llm_accent_refine(stepped, examples)
    if refined and refined != raw_text:
        logger.info(f"[ACCENT/{session_id}] {raw_text!r} -> {refined!r}")
    return refined

def record_accent_correction(session_id, raw_text, corrected_text):
    """Called whenever we observe a (raw, corrected) pair — either from
    explicit /accent/feedback or implicitly from a user retry."""
    raw = (raw_text or "").strip()
    corrected = (corrected_text or "").strip()
    if not raw or not corrected or raw.lower() == corrected.lower():
        return
    if len(raw) > 200 or len(corrected) > 200:
        return
    with ACCENT_LOCK:
        profile = _load_accent_profile(session_id)
        subs = profile.setdefault("substitutions", {})
        examples = profile.setdefault("examples", [])
        # Track this exact pair as a substitution. We also keep it as a
        # few-shot example for the LLM refiner.
        subs[raw] = corrected
        # Trim oldest substitutions if we have too many.
        if len(subs) > _MAX_SUBSTITUTIONS:
            for k in list(subs.keys())[: len(subs) - _MAX_SUBSTITUTIONS]:
                subs.pop(k, None)
        examples.append({"raw": raw, "corrected": corrected})
        profile["examples"] = examples[-_MAX_EXAMPLES:]
        _save_accent_profile(session_id, profile)
    logger.info(f"[ACCENT/{session_id}] learned: {raw!r} -> {corrected!r}")

def _resolve_session_id(default="default"):
    return (
        request.headers.get("X-Session-Id")
        or request.args.get("session_id")
        or default
    )

# =========================================================
# TTS
# =========================================================
# Map a voice preference name -> (gTTS lang, gTTS tld). gTTS does not expose
# an explicit gender knob, but different localized voices sound audibly
# different (US English vs UK English). The device sends `?voice=<name>` on
# each /tts call; unknown values fall back to the default female-presenting
# US voice.
_VOICE_TABLE = {
    "female":   ("en", "com"),       # US English, female-presenting (default gTTS voice)
    "male":     ("en", "co.uk"),     # UK English, deeper / male-presenting
}

def _tts_one(text, lang, tld):
    """Synthesize a single segment of text -> 16k mono int16 PCM bytes."""
    from gtts import gTTS
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        tmp = f.name
    try:
        gTTS(text=text, lang=lang, tld=tld, slow=False).save(tmp)
        audio = AudioSegment.from_file(tmp, format="mp3")
        audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        return audio.raw_data
    finally:
        try: os.remove(tmp)
        except Exception: pass

def _split_for_tts(text, max_len=240):
    """Break a long reply into TTS-friendly chunks at sentence boundaries
    so nothing is truncated. Each chunk is <= max_len chars."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_len:
        return [text]
    chunks, buf = [], ""
    # Greedy: append words; flush at sentence boundary once >= max_len/2,
    # or hard-flush at max_len.
    import re
    parts = re.split(r'(?<=[\.\?\!])\s+', text)
    for p in parts:
        if not p:
            continue
        if len(buf) + len(p) + 1 <= max_len:
            buf = (buf + " " + p).strip()
        else:
            if buf:
                chunks.append(buf)
            # If a single "sentence" is itself too long, hard-wrap on spaces.
            while len(p) > max_len:
                cut = p.rfind(" ", 0, max_len)
                if cut < max_len // 2:
                    cut = max_len
                chunks.append(p[:cut].strip())
                p = p[cut:].strip()
            buf = p
    if buf:
        chunks.append(buf)
    return chunks

def generate_tts_pcm(text, voice="female"):
    """Return raw 16kHz mono int16 PCM bytes (no WAV header).

    The full reply is spoken end-to-end: long text is split into sentence
    chunks, each synthesized separately, then concatenated with a short
    pause. A trailing silence pad is appended so the device's I2S DMA
    queue can drain without chopping the last syllable.
    """
    if tts_type != "gtts":
        return b""
    text = (text or "").replace("\n", " ").strip()
    if not text:
        return b""
    lang, tld = _VOICE_TABLE.get((voice or "female").lower(), _VOICE_TABLE["female"])
    # Generous safety cap so a runaway LLM reply can't OOM the Space, but
    # long conversational answers (~3-4k chars) are fully spoken.
    if len(text) > 4000:
        text = text[:4000]
    segments = _split_for_tts(text, max_len=240)
    # ~120ms of silence between segments so the join is natural.
    inter_silence = b"\x00\x00" * int(16000 * 0.12)
    # ~400ms trailing silence so gTTS clipping + I2S DMA drain don't eat
    # the final word ("buddy" -> "bud" bug).
    tail_silence = b"\x00\x00" * int(16000 * 0.4)
    pieces = []
    for i, seg in enumerate(segments):
        try:
            pcm = _tts_one(seg, lang, tld)
        except Exception as e:
            logger.warning(f"tts segment failed ({i}): {e}")
            continue
        if pcm:
            pieces.append(pcm)
            if i != len(segments) - 1:
                pieces.append(inter_silence)
    if not pieces:
        return b""
    pieces.append(tail_silence)
    return b"".join(pieces)


# =========================================================
# CHAT
# =========================================================
@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json(force=True, silent=True) or {}
        msg_type = data.get("type", "user_message")
        if msg_type == "setting_update":
            # just ack - no LLM call needed
            return jsonify({"status": "ok", "response": ""})

        # Event-triggered companion speech (SOS / medication reminder).
        # The device sends type="sos" or type="medication_reminder" and
        # plays whatever short, warm line we return through its speaker.
        if msg_type in ("sos", "medication_reminder"):
            mode = data.get("mode", "GENERAL")
            session_id = (
                data.get("session_id")
                or request.headers.get("X-Session-Id")
                or "esp32_user"
            )
            if msg_type == "sos":
                hidden_prompt = (
                    "INTERNAL EVENT: the user just pressed the SOS button on "
                    "their Mind Buddy device. They are likely panicked or in "
                    "distress. Speak DIRECTLY to them, in 2 short warm "
                    "sentences. Reassure them help is on the way and guide "
                    "them to breathe slowly. Plain text only, no JSON, no actions."
                )
                fallback = ("It's okay. Help is on the way. Take a slow breath in, "
                            "and a slow breath out. You are not alone.")
            else:
                hidden_prompt = (
                    "INTERNAL EVENT: it is time for the user's medication. "
                    "Speak DIRECTLY to them in 2 short warm sentences, "
                    "encouraging them to take their pill now and drink some "
                    "water. Plain text only, no JSON, no actions."
                )
                fallback = ("Hi, it is time to take your medication. "
                            "Please take it now and drink some water.")
            try:
                spoken, _ = generate_llm_response(hidden_prompt, session_id, mode)
                if not spoken or not spoken.strip():
                    spoken = fallback
            except Exception as e:
                logger.warning(f"companion event LLM failed: {e}")
                spoken = fallback
            # Bridge SOS to the webapp so the caregiver dashboard alerts.
            if msg_type == "sos":
                try:
                    webapp_post("/api/public/device/sos",
                                {"note": data.get("note", "SOS from device")})
                except Exception as e:
                    logger.warning(f"sos webapp bridge failed: {e}")
            return jsonify({"status": "success", "response": spoken})


        message = data.get("message", "")
        mode    = data.get("mode", "GENERAL")
        language = data.get("language", "en")
        session_id = (
            data.get("session_id")
            or request.headers.get("X-Session-Id")
            or "esp32_user"
        )
        # Pass the message through the per-user accent layer before the
        # LLM sees it, so recurring mis-hears are silently corrected.
        refined = apply_accent_layer(session_id, message)
        if refined and refined != message:
            logger.info(f"/chat accent-corrected -> {refined!r}")
            message = refined
        logger.info(f"/chat msg={message!r} mode={mode} lang={language}")

        spoken, action = generate_llm_response(message, session_id, mode, language)
        if not spoken or not spoken.strip():
            spoken = "I'm right here with you. Tell me more about how you're feeling."
        resp = {"status": "success", "response": spoken}
        if action:
            resp["action"] = action
            # Bridge selected actions to the Mind Buddy App webapp.
            try:
                if action.get("type") == "set_medication":
                    webapp_post("/api/public/device/sync", {
                        "med": {
                            "hour": int(action.get("hour", 20)),
                            "minute": int(action.get("minute", 0)),
                            "enabled": bool(action.get("enabled", True)),
                        }
                    })
            except Exception as e:
                logger.warning(f"action bridge error: {e}")
        # If the device explicitly forwarded an SOS message type, push it.
        if msg_type == "sos":
            webapp_post("/api/public/device/sos",
                        {"note": data.get("note", "SOS from device")})
        return jsonify(resp)
    except Exception as e:
        logger.error(f"/chat error: {e}")
        # Never return an empty/error body — the device should always have
        # something kind to say back to the user.
        return jsonify({
            "status": "success",
            "response": "I'm here with you. Let's try that again — what would you like to talk about?"
        }), 200

# =========================================================
# TRANSCRIBE (STT ONLY, used for wake polling + prompt)
# =========================================================
@app.route('/transcribe', methods=['POST'])
def transcribe():
    try:
        if not request.data:
            return jsonify({"text": ""})
        session_id = _resolve_session_id()
        raw = transcribe_bytes(request.data, session_id=session_id)
        text = apply_accent_layer(session_id, raw) if raw else raw
        # Implicit learning: if the accent layer refined the raw output,
        # remember that mapping so the device improves over time without
        # any explicit feedback step.
        if raw and text and raw.strip().lower() != text.strip().lower():
            try:
                record_accent_correction(session_id, raw, text)
            except Exception as e:
                logger.warning(f"implicit accent record failed: {e}")
        return jsonify({"text": text, "raw": raw})
    except Exception as e:
        logger.error(f"/transcribe error: {e}")
        return jsonify({"text": ""}), 500

# =========================================================
# ACCENT FEEDBACK
# Clients (webapp, device) can post a (raw, corrected) pair here when the
# user fixes a mis-transcribed phrase. The next time the same accented
# phrase comes in, it will already be corrected upstream of the LLM.
# =========================================================
@app.route('/accent/feedback', methods=['POST'])
def accent_feedback():
    try:
        data = request.get_json(force=True, silent=True) or {}
        session_id = (
            data.get("session_id")
            or request.headers.get("X-Session-Id")
            or "default"
        )
        raw = data.get("raw", "")
        corrected = data.get("corrected", "")
        record_accent_correction(session_id, raw, corrected)
        return jsonify({"status": "ok"})
    except Exception as e:
        logger.error(f"/accent/feedback error: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/accent/profile', methods=['GET'])
def accent_profile():
    session_id = _resolve_session_id()
    with ACCENT_LOCK:
        profile = _load_accent_profile(session_id)
        return jsonify({
            "session_id": session_id,
            "substitutions": dict(profile.get("substitutions") or {}),
            "examples": list(profile.get("examples") or []),
        })

# =========================================================
# LEGACY /process_audio - kept for backwards compatibility,
# now also returns structured action.
# =========================================================
@app.route('/process_audio', methods=['POST'])
def process_audio():
    try:
        if request.data:
            user_text = transcribe_bytes(request.data)
        else:
            user_text = ""
        if not user_text:
            return jsonify({"input": "", "message": "", "action": None})
        spoken, action = generate_llm_response(user_text, "VOICE")
        return jsonify({
            "status": "success",
            "input": user_text,
            "message": spoken,
            "action": action,
        })
    except Exception as e:
        logger.error(f"/process_audio error: {e}")
        return jsonify({"error": str(e)}), 500

# =========================================================
# TTS  -> raw PCM 16k mono int16 (what the ESP32 expects)
# =========================================================
@app.route('/tts', methods=['POST'])
def tts():
    try:
        data = request.get_json(force=True, silent=True) or {}
        text = data.get("text", "")
        # voice can come from JSON body OR ?voice= query string for easy device use
        voice = (
            data.get("voice")
            or request.args.get("voice")
            or "female"
        )
        pcm = generate_tts_pcm(text, voice=voice)
        if not pcm:
            return Response(b"", status=204)
        return Response(pcm, mimetype="application/octet-stream")
    except Exception as e:
        logger.error(f"/tts error: {e}")
        return Response(b"", status=500)

# =========================================================
# MUSIC  -> raw PCM 16k mono int16
# Streams a real track from YouTube (via yt-dlp + ffmpeg) instead of
# the previous synthesized arpeggio. The user's query is used as a
# YouTube search ("ytsearch1:<query>"), the best audio is downloaded
# and resampled to 16k mono int16 on the fly.
# =========================================================
import shutil as _shutil
import subprocess as _subprocess

# Curated public internet-radio streams. These are free, 24/7, no-auth
# streams used when the AI emits a play_radio action. They are intentionally
# mood-tagged so the LLM can pick one based on how the user feels.
RADIO_STATIONS = {
    # IDs here MUST match src/lib/radio-stations.ts in the web app so the
    # [[music:<id>]] directive resolves to the right stream.
    "ambient":   "https://ice5.somafm.com/groovesalad-128-mp3",  # SomaFM Groove Salad
    "lush":      "https://ice5.somafm.com/lush-128-mp3",          # SomaFM Lush
    "synth":     "https://ice5.somafm.com/synphaera-128-mp3",     # SomaFM Synphaera
    "rock":      "https://stream.radioparadise.com/mp3-128",      # Radio Paradise
    "lofi":      "https://ice5.somafm.com/fluid-128-mp3",         # SomaFM Fluid (Lo-Fi)
    "cyberpunk": "https://ice5.somafm.com/defcon-128-mp3",        # SomaFM Defcon
    # legacy / mood aliases the LLM might still emit
    "calm":      "https://ice5.somafm.com/groovesalad-128-mp3",
    "jazz":      "https://ice5.somafm.com/groovesalad-128-mp3",
}

def _resolve_audio_url(query: str) -> str:
    """If query is `radio:<station>`, return the curated stream URL.
    Otherwise resolve via yt-dlp ytsearch1:<query>."""
    q = (query or "").strip()
    if q.lower().startswith("radio:"):
        station = q.split(":", 1)[1].strip().lower() or "lofi"
        url = RADIO_STATIONS.get(station) or RADIO_STATIONS["lofi"]
        return url
    if not _shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp is not installed on the server")
    ydl = _subprocess.run(
        ["yt-dlp", "-f", "bestaudio", "-g", f"ytsearch1:{q}"],
        capture_output=True, text=True, timeout=25,
    )
    if ydl.returncode != 0 or not ydl.stdout.strip():
        raise RuntimeError(f"yt-dlp failed: {ydl.stderr.strip()[:200]}")
    return ydl.stdout.strip().splitlines()[0]

def _stream_music_pcm(query: str, max_seconds: int = 180):
    """Yield raw PCM 16k mono int16 chunks for the resolved audio URL."""
    if not _shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed on the server")
    audio_url = _resolve_audio_url(query)
    # Pipe through ffmpeg -> 16k mono s16le PCM, capped to max_seconds.
    ff = _subprocess.Popen(
        [
            "ffmpeg", "-loglevel", "error", "-nostdin",
            "-i", audio_url,
            "-t", str(max_seconds),
            "-vn", "-ac", "1", "-ar", "16000",
            "-f", "s16le", "pipe:1",
        ],
        stdout=_subprocess.PIPE, stderr=_subprocess.PIPE,
    )
    try:
        while True:
            chunk = ff.stdout.read(4096)
            if not chunk:
                break
            yield chunk
    finally:
        try:
            ff.kill()
        except Exception:
            pass

@app.route('/music', methods=['GET'])
def music():
    q = request.args.get("q", "lofi hip hop")
    try:
        return Response(_stream_music_pcm(q), mimetype="application/octet-stream")
    except Exception as e:
        logger.error(f"/music error: {e}")
        # Fall back to a short silence so the device doesn't get a 500
        # (which would surface to the user as "music failed"). One second
        # of silence at 16k mono int16.
        silence = (b"\x00\x00") * 16000
        return Response(silence, mimetype="application/octet-stream", status=200)

# =========================================================
# HEALTH / STATUS / HOME
# =========================================================
@app.route('/health')
def health():
    return jsonify({
        "status": "ready",
        "models": {"stt": stt_pipeline is not None,
                   "llm": hf_client is not None,
                   "tts": tts_type},
        "memory": get_memory_usage()
    })

@app.route('/status')
def status():
    return jsonify({"ready": True})

@app.route('/')
def home():
    return "Mind Buddy Companion Server Running"

@app.errorhandler(Exception)
def handle_exception(e):
    logger.error(f"Unhandled exception: {e}", exc_info=True)
    return jsonify({"error": "Internal server error"}), 500

# =========================================================
# MAIN
# =========================================================
if __name__ == '__main__':
    try:
        logger.info("Starting Mind Buddy Companion Server")
        initialize_models()
        logger.info("Server Ready")
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        raise

    port = int(os.environ.get('PORT', 7860))
    logger.info(f"Running on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True, use_reloader=False)
