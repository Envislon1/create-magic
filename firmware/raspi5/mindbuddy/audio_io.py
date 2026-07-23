"""Audio input (ReSpeaker 4-mic) and output (MAX98357A I2S).
Downmixes 4 mic channels to mono @ 16 kHz for whisper.
"""
from __future__ import annotations
import queue, threading, logging
import numpy as np
import sounddevice as sd
import soundfile as sf

log = logging.getLogger("audio")

class AudioIO:
    def __init__(self, in_device: str, out_device: str, sr: int = 16000):
        self.sr = sr; self.in_device = in_device; self.out_device = out_device
        self._q: queue.Queue[np.ndarray] = queue.Queue(maxsize=50)
        self._stream = None
        self._enabled = threading.Event(); self._enabled.set()
        self._volume = 0.7  # 0..1

    # ---------- input ----------
    def _cb(self, indata, frames, time_info, status):
        if status: log.debug("in status %s", status)
        if not self._enabled.is_set(): return
        # 4-mic → mono
        mono = indata.mean(axis=1) if indata.ndim == 2 and indata.shape[1] > 1 else indata.ravel()
        try: self._q.put_nowait(mono.astype(np.float32).copy())
        except queue.Full: pass

    def start_capture(self):
        self._stream = sd.InputStream(
            device=self.in_device, channels=4, samplerate=self.sr,
            blocksize=int(self.sr * 0.03), dtype="float32", callback=self._cb,
        )
        self._stream.start()
        log.info("capture started on %s", self.in_device)

    def stop_capture(self):
        if self._stream:
            try: self._stream.stop(); self._stream.close()
            except Exception: pass
            self._stream = None

    def pause(self):  self._enabled.clear()
    def resume(self): self._enabled.set()
    def flush(self):
        with self._q.mutex: self._q.queue.clear()

    def read_seconds(self, secs: float) -> np.ndarray:
        want = int(self.sr * secs); buf = []
        while sum(len(b) for b in buf) < want:
            try: buf.append(self._q.get(timeout=1.0))
            except queue.Empty: break
        return np.concatenate(buf) if buf else np.zeros(0, dtype=np.float32)

    # ---------- output ----------
    def set_volume(self, v: int):
        self._volume = max(0.0, min(1.0, v / 100.0))

    def play_wav(self, path: str, blocking: bool = True):
        data, sr = sf.read(path, dtype="float32")
        if data.ndim == 1: data = data[:, None]
        data = data * self._volume
        sd.play(data, sr, device=self.out_device)
        if blocking: sd.wait()

    def play_pcm(self, pcm: np.ndarray, sr: int, blocking: bool = True):
        if pcm.dtype != np.float32:
            pcm = pcm.astype(np.float32) / (32768.0 if pcm.dtype == np.int16 else 1.0)
        sd.play(pcm * self._volume, sr, device=self.out_device)
        if blocking: sd.wait()

    def stop_playback(self):
        sd.stop()

    def beep(self, freq: float = 880, ms: int = 120):
        t = np.linspace(0, ms / 1000.0, int(self.sr * ms / 1000.0), False)
        tone = 0.3 * np.sin(2 * np.pi * freq * t).astype(np.float32)
        self.play_pcm(tone, self.sr, blocking=False)
