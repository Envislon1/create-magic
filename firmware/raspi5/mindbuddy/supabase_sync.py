"""Supabase sync using the same device_sync_get / device_sync_post RPCs the
ESP32 firmware already talks to. Runs on a 15 s tick + on-demand pushes."""
from __future__ import annotations
import json, logging, threading, time
from typing import Callable, Any, Optional
import requests

log = logging.getLogger("sync")

class SupabaseSync:
    def __init__(self, url: str, anon_key: str, device_code: str,
                 on_state: Callable[[dict], None]):
        self.base = url.rstrip("/")
        self.key = anon_key
        self.code = device_code
        self.on_state = on_state
        self._stop = threading.Event()
        self._state: dict = {}

    def start(self):
        if not (self.base and self.key and self.code):
            log.warning("supabase sync disabled (missing url/key/code)"); return
        threading.Thread(target=self._loop, daemon=True).start()

    def stop(self): self._stop.set()

    @property
    def state(self) -> dict: return dict(self._state)

    def _rpc(self, fn: str, payload: dict) -> Optional[dict]:
        try:
            r = requests.post(
                f"{self.base}/rest/v1/rpc/{fn}",
                headers={"apikey": self.key, "Authorization": f"Bearer {self.key}",
                         "Content-Type": "application/json"},
                json={"params": payload}, timeout=10,
            )
            if r.status_code >= 400:
                log.warning("rpc %s http %d: %s", fn, r.status_code, r.text[:200])
                return None
            return r.json()
        except Exception as e:
            log.warning("rpc %s failed: %s", fn, e); return None

    def push(self, payload: dict):
        self._rpc("device_sync_post", {"_code": self.code, "_payload": payload})

    def sos(self, note: str = ""):
        self._rpc("device_sos_post", {"_code": self.code, "_payload": {"note": note}})

    def _loop(self):
        while not self._stop.is_set():
            state = self._rpc("device_sync_get", {"_code": self.code})
            if isinstance(state, dict) and "error" not in state:
                self._state = state
                try: self.on_state(state)
                except Exception as e: log.exception("state handler: %s", e)
            time.sleep(15)
