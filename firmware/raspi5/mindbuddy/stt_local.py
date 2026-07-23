"""Local streaming STT via whisper.cpp bindings + a simple VAD gate.
Wake-word is a string match on a short rolling transcription.
"""
from __future__ import annotations
import logging, os, threading, queue, time
import numpy as np
import webrtcvad
from pywhispercpp.model import Model as WhisperModel

log = logging.getLogger("stt")

class LocalSTT:
    def __init__(self, model_path: str, sr: int = 16000):
        self.sr = sr
        resolved = self._resolve_model(model_path)
        log.info("loading whisper %s", resolved)
        self.model = WhisperModel(resolved, n_threads=4, print_realtime=False, print_progress=False)
        self.vad = webrtcvad.Vad(2)

    @staticmethod
    def _resolve_model(model_path: str) -> str:
        """pywhispercpp accepts either a known model name (e.g. `tiny.en`) or
        an absolute file path. Relative paths from the wrong CWD fail with
        `Invalid model name`. If the given string looks like a file path,
        resolve it to an absolute path and verify it exists; otherwise fall
        back to a known short name so pywhispercpp can auto-download it."""
        mp = (model_path or "").strip()
        looks_like_path = ("/" in mp) or mp.endswith(".bin")
        if looks_like_path:
            abs_path = os.path.abspath(os.path.expanduser(mp))
            if os.path.isfile(abs_path):
                return abs_path
            log.warning("whisper model file not found at %s — falling back to 'tiny.en'", abs_path)
            return "tiny.en"
        return mp or "tiny.en"

    def _to_int16(self, x: np.ndarray) -> np.ndarray:
        x = np.clip(x, -1.0, 1.0)
        return (x * 32767.0).astype(np.int16)

    def transcribe(self, audio: np.ndarray) -> str:
        if audio.size < self.sr // 4: return ""
        try:
            segs = self.model.transcribe(audio.astype(np.float32))
            return " ".join(s.text for s in segs).strip()
        except Exception as e:
            log.warning("whisper failed: %s", e); return ""

    # -------- VAD-based utterance capture --------
    def wait_for_speech(self, audio_iter, max_silence_ms: int = 900, max_utt_ms: int = 8000) -> np.ndarray:
        """Consume 30ms mono float32 frames from audio_iter until end-of-utterance."""
        frame_ms = 30
        max_silence = max_silence_ms // frame_ms
        max_frames  = max_utt_ms // frame_ms
        collected = []; silence = 0; started = False
        for f in audio_iter:
            i16 = self._to_int16(f)
            try: is_speech = self.vad.is_speech(i16.tobytes(), self.sr)
            except Exception: is_speech = False
            if is_speech:
                started = True; silence = 0; collected.append(f)
            elif started:
                silence += 1; collected.append(f)
                if silence >= max_silence: break
            if len(collected) >= max_frames: break
        return np.concatenate(collected) if collected else np.zeros(0, dtype=np.float32)
