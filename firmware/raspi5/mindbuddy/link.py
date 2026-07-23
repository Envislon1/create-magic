"""Line-delimited JSON over UART to the LilyGo."""
from __future__ import annotations
import json, threading, time, logging
from queue import Queue, Empty
from typing import Callable, Optional
import serial

log = logging.getLogger("link")

class PiLink:
    def __init__(self, port: str, baud: int, on_message: Callable[[dict], None]):
        self.port = port; self.baud = baud
        self.on_message = on_message
        self._ser: Optional[serial.Serial] = None
        self._tx: Queue = Queue()
        self._stop = threading.Event()
        self._last_rx = time.time()

    def start(self):
        self._ser = serial.Serial(self.port, self.baud, timeout=0.2)
        log.info("serial %s @ %d open", self.port, self.baud)
        threading.Thread(target=self._rx_loop, daemon=True).start()
        threading.Thread(target=self._tx_loop, daemon=True).start()
        threading.Thread(target=self._heartbeat, daemon=True).start()
        # announce
        self.send({"type": "boot", "fw": "1.0.0", "model": "pi5-mindbuddy"})

    def stop(self):
        self._stop.set()
        try:
            if self._ser: self._ser.close()
        except Exception: pass

    def send(self, msg: dict):
        msg = {"src": "pi", **msg}
        self._tx.put(json.dumps(msg, ensure_ascii=False))

    # -------- internals --------
    def _rx_loop(self):
        buf = b""
        while not self._stop.is_set():
            try:
                chunk = self._ser.read(256) if self._ser else b""
            except Exception as e:
                log.warning("rx error: %s", e); time.sleep(1); continue
            if not chunk: continue
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.strip()
                if not line: continue
                try:
                    msg = json.loads(line.decode("utf-8", "replace"))
                except Exception:
                    log.debug("drop malformed: %r", line[:120]); continue
                self._last_rx = time.time()
                try:
                    self.on_message(msg)
                except Exception as e:
                    log.exception("handler error: %s", e)

    def _tx_loop(self):
        while not self._stop.is_set():
            try: line = self._tx.get(timeout=0.2)
            except Empty: continue
            try:
                if self._ser: self._ser.write((line + "\n").encode("utf-8"))
            except Exception as e:
                log.warning("tx error: %s", e); time.sleep(1)

    def _heartbeat(self):
        while not self._stop.is_set():
            time.sleep(5)
            self.send({"type": "ping"})
            if time.time() - self._last_rx > 15:
                log.warning("link silent >15s")
