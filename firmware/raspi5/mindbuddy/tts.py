"""Hybrid TTS for MindBuddy.

Priority (per turn):
    1. Cloud (OpenAI) when allowed AND the pipeline currently prefers cloud.
    2. Local engine — Kokoro (default) or Piper — selectable at runtime.
    3. espeak-ng as a last-resort fallback so the box never goes silent.

The local path adds the "counselor voice" polish:
    * strips <soft>/<calm>/<warm>/<excited> emotion tags but uses them to
      tune speaking rate + pause length + gain,
    * splits the reply into sentences and inserts a short silence between
      each one (natural, unhurried delivery),
    * inserts a slightly longer breath before the first sentence of soft /
      calm replies so the user can hear the shift in tone.
"""
from __future__ import annotations
import io, logging, os, re, subprocess, tempfile
from dataclasses import dataclass
from typing import Iterable, Optional
import numpy as np
import soundfile as sf
import requests

log = logging.getLogger("tts")

# ---- emotion tags ---------------------------------------------------------

@dataclass(frozen=True)
class EmotionStyle:
    name: str
    rate: float        # 1.0 = neutral, <1 slower
    pause_ms: int      # silence between sentences
    lead_ms: int       # extra silence before first sentence
    gain: float        # linear multiplier

_STYLES: dict[str, EmotionStyle] = {
    "soft":    EmotionStyle("soft",    0.90, 380, 250, 0.95),
    "calm":    EmotionStyle("calm",    0.88, 420, 300, 0.95),
    "warm":    EmotionStyle("warm",    0.98, 260, 120, 1.00),
    "excited": EmotionStyle("excited", 1.08, 160,  40, 1.05),
    "neutral": EmotionStyle("neutral", 1.00, 260, 120, 1.00),
}
_TAG_RE = re.compile(r"<\s*(soft|calm|warm|excited|neutral)\s*>", re.I)
_SENT_SPLIT = re.compile(r"(?<=[\.\!\?])\s+|\n+")

def _parse_style(text: str) -> tuple[EmotionStyle, str]:
    tag = None
    def _cap(m):
        nonlocal tag
        if tag is None: tag = m.group(1).lower()
        return ""
    cleaned = _TAG_RE.sub(_cap, text).strip()
    return _STYLES.get(tag or "neutral", _STYLES["neutral"]), cleaned

def _sentences(text: str) -> list[str]:
    parts = [s.strip() for s in _SENT_SPLIT.split(text) if s and s.strip()]
    return parts or ([text.strip()] if text.strip() else [])

def _silence(sr: int, ms: int) -> np.ndarray:
    n = max(0, int(sr * ms / 1000.0))
    return np.zeros(n, dtype=np.float32)

def _resample(x: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr or x.size == 0: return x
    # linear resample — good enough for speech playback on the Pi
    ratio = dst_sr / float(src_sr)
    n_out = int(round(x.size * ratio))
    if n_out <= 1: return x
    xp = np.linspace(0.0, 1.0, x.size, endpoint=False, dtype=np.float64)
    fp = x.astype(np.float64)
    xn = np.linspace(0.0, 1.0, n_out, endpoint=False, dtype=np.float64)
    return np.interp(xn, xp, fp).astype(np.float32)

def _mono(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 1 else x.mean(axis=1)


# ---- Kokoro (default local) ----------------------------------------------

class _KokoroBackend:
    """Lazy-loaded kokoro-onnx wrapper. Voice can be swapped at runtime."""
    def __init__(self, model_path: str, voices_path: str, voice: str):
        self.model_path  = model_path
        self.voices_path = voices_path
        self.voice = voice
        self._k = None
        self._ok = None

    def available(self) -> bool:
        if self._ok is not None: return self._ok
        try:
            if not (os.path.exists(self.model_path) and os.path.exists(self.voices_path)):
                log.warning("kokoro model/voices missing (%s / %s)", self.model_path, self.voices_path)
                self._ok = False; return False
            from kokoro_onnx import Kokoro  # type: ignore
            self._k = Kokoro(self.model_path, self.voices_path)
            self._ok = True
            log.info("kokoro tts ready (voice=%s)", self.voice)
        except Exception as e:
            log.warning("kokoro unavailable: %s", e); self._ok = False
        return self._ok

    def set_voice(self, v: str):
        if v: self.voice = v

    def synth(self, text: str, speed: float) -> tuple[np.ndarray, int]:
        if not self.available(): raise RuntimeError("kokoro not available")
        audio, sr = self._k.create(text, voice=self.voice, speed=float(speed), lang="en-us")
        return _mono(np.asarray(audio, dtype=np.float32)), int(sr)


# ---- Piper (secondary local) ---------------------------------------------

class _PiperBackend:
    """Recommended voices in descending naturalness:
        en_US-lessac-medium, en_US-amy-medium, en_GB-alan-medium,
        en_US-ryan-high, en_US-kathleen-low
    """
    def __init__(self, voice_path: str):
        self.voice_path = voice_path

    def available(self) -> bool:
        return bool(self.voice_path) and os.path.exists(self.voice_path)

    def set_voice(self, path: str):
        if path: self.voice_path = path

    def synth(self, text: str, speed: float) -> tuple[np.ndarray, int]:
        # piper's --length_scale is inverse of "speed": >1 = slower
        length_scale = f"{max(0.5, min(2.0, 1.0 / max(0.5, speed))):.2f}"
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f: wav = f.name
        try:
            subprocess.run(
                ["piper", "--model", self.voice_path,
                 "--length_scale", length_scale,
                 "--output_file", wav],
                input=text.encode("utf-8"), check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            data, sr = sf.read(wav, dtype="float32")
            return _mono(data), sr
        finally:
            try: os.unlink(wav)
            except Exception: pass


# ---- espeak-ng (never-fail fallback) -------------------------------------

class _EspeakBackend:
    def __init__(self): self.voice_pref = "female"
    def set_voice_pref(self, v: str): self.voice_pref = "male" if str(v).lower() == "male" else "female"
    def synth(self, text: str, speed: float) -> tuple[np.ndarray, int]:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f: wav = f.name
        try:
            voice = "en-us+f3" if self.voice_pref == "female" else "en-us+m3"
            wpm = int(170 * speed)
            subprocess.run(["espeak-ng", "-v", voice, "-s", str(wpm), "-w", wav, text],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            data, sr = sf.read(wav, dtype="float32")
            return _mono(data), sr
        finally:
            try: os.unlink(wav)
            except Exception: pass


# ---- HybridTTS ------------------------------------------------------------

class HybridTTS:
    """One entrypoint: `synth(text, prefer_cloud=?) -> (pcm, sr)`.

    The returned PCM already includes emotion-tag-aware sentence pauses and
    a lead-in breath, so `main.py` can hand it straight to `AudioIO`.
    """
    def __init__(self, piper_voice: str,
                 openai_key: str = "", openai_model: str = "gpt-4o-mini-tts",
                 openai_voice: str = "alloy",
                 local_engine: str = "kokoro",
                 kokoro_model: str = "./models/kokoro/kokoro-v0_19.onnx",
                 kokoro_voices: str = "./models/kokoro/voices.bin",
                 kokoro_voice: str = "af_heart"):
        self.openai_key = openai_key
        self.openai_model = openai_model
        self.openai_voice = openai_voice
        self.cloud_allowed = True
        self._voice_pref = "female"

        self.kokoro = _KokoroBackend(kokoro_model, kokoro_voices, kokoro_voice)
        self.piper  = _PiperBackend(piper_voice)
        self.espeak = _EspeakBackend()
        self.local_engine = (local_engine or "kokoro").lower()

    # ---- runtime controls ----
    def set_voice(self, v: str):
        self._voice_pref = "male" if str(v).lower() == "male" else "female"
        self.espeak.set_voice_pref(self._voice_pref)
        # Map a coarse female/male preference to a Kokoro voice.
        self.kokoro.set_voice("am_michael" if self._voice_pref == "male" else "af_heart")

    def set_cloud_allowed(self, allowed: bool): self.cloud_allowed = allowed

    def set_local_engine(self, engine: str):
        e = (engine or "").lower()
        if e in ("kokoro", "piper"):
            self.local_engine = e
            log.info("local tts engine → %s", e)

    def active_local_engine(self) -> str:
        # Reflect what would actually run, not just the request.
        if self.local_engine == "kokoro" and self.kokoro.available(): return "kokoro"
        if self.piper.available(): return "piper"
        if self.local_engine == "piper": return "piper"
        return "espeak"

    # ---- main entry ----
    def synth(self, text: str, prefer_cloud: bool) -> tuple[np.ndarray, int]:
        text = (text or "").strip()
        if not text: return np.zeros(0, dtype=np.float32), 22050

        style, cleaned = _parse_style(text)
        # Cloud path: send the full reply as-is (with punctuation preserved
        # so the cloud voice does the pausing itself); no manual splicing.
        if prefer_cloud and self.cloud_allowed and self.openai_key:
            try: return self._openai(cleaned, style)
            except Exception as e: log.warning("cloud tts failed: %s", e)

        # Local path: sentence-by-sentence with pauses between.
        return self._local_expressive(cleaned, style)

    # ---- cloud ----
    def _openai(self, text: str, style: EmotionStyle) -> tuple[np.ndarray, int]:
        instr = {
            "soft":    "Speak softly, slowly and with warm empathy, as a caring counselor.",
            "calm":    "Speak calmly and slowly, with grounded, unhurried breaths between sentences.",
            "warm":    "Speak warmly and conversationally, like a close friend.",
            "excited": "Speak with gentle, uplifting brightness.",
            "neutral": "Speak warmly and naturally.",
        }.get(style.name, "Speak warmly and naturally.")
        r = requests.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {self.openai_key}", "Content-Type": "application/json"},
            json={"model": self.openai_model, "voice": self.openai_voice,
                  "input": text, "response_format": "wav",
                  "instructions": instr, "speed": style.rate},
            timeout=30,
        )
        r.raise_for_status()
        data, sr = sf.read(io.BytesIO(r.content), dtype="float32")
        return _mono(data) * style.gain, sr

    # ---- local ----
    def _local_expressive(self, text: str, style: EmotionStyle) -> tuple[np.ndarray, int]:
        sents = _sentences(text)
        if not sents: return np.zeros(0, dtype=np.float32), 22050

        chunks: list[np.ndarray] = []
        target_sr: Optional[int] = None

        def _append(pcm: np.ndarray, sr: int):
            nonlocal target_sr
            if pcm.size == 0: return
            if target_sr is None: target_sr = sr
            elif sr != target_sr: pcm = _resample(pcm, sr, target_sr)
            chunks.append(pcm)

        # lead-in silence for soft/calm — reads as an empathetic breath
        # (we prepend it after we know target_sr).
        for i, sent in enumerate(sents):
            pcm, sr = self._synth_local_one(sent, style.rate)
            _append(pcm, sr)
            if i != len(sents) - 1 and target_sr is not None:
                chunks.append(_silence(target_sr, style.pause_ms))

        if target_sr is None: return np.zeros(0, dtype=np.float32), 22050
        if style.lead_ms > 0: chunks.insert(0, _silence(target_sr, style.lead_ms))
        out = np.concatenate(chunks).astype(np.float32) * style.gain
        return out, target_sr

    def _synth_local_one(self, sentence: str, speed: float) -> tuple[np.ndarray, int]:
        order: list[str] = []
        if self.local_engine == "piper":
            order = ["piper", "kokoro", "espeak"]
        else:
            order = ["kokoro", "piper", "espeak"]
        last_err: Optional[Exception] = None
        for eng in order:
            try:
                if eng == "kokoro" and self.kokoro.available():
                    return self.kokoro.synth(sentence, speed)
                if eng == "piper" and self.piper.available():
                    return self.piper.synth(sentence, speed)
                if eng == "espeak":
                    return self.espeak.synth(sentence, speed)
            except Exception as e:
                last_err = e; log.warning("%s failed: %s", eng, e)
        if last_err: log.error("all local tts engines failed: %s", last_err)
        return np.zeros(0, dtype=np.float32), 22050
