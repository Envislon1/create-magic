"""MindBuddy main orchestrator.

Wires: audio <-> STT <-> hybrid LLM <-> hybrid TTS <-> Supabase <-> LilyGo link.

Adds:
    * Language selection (TFT + debug menu) — the LLM is instructed to
      stay in the selected language until the user switches.
    * Medication reminder scheduler — watches app-state med items pushed
      from Supabase and, at the user-set time, prompts the LLM for a warm
      spoken reminder.
    * Debug REPL that first asks the user to pick a support mode by number
      and a language, so the same code path can be exercised without the
      TFT hardware.
"""
from __future__ import annotations
import logging, threading, time, json, queue, signal, sys, re
from datetime import datetime
from typing import List, Dict

from .config import CFG
import argparse
from .link import PiLink
from .audio_io import AudioIO
from .stt_local import LocalSTT
from .llm import HybridLLM
from .tts import HybridTTS
from .supabase_sync import SupabaseSync
from .prompts import SYSTEM_PROMPT, build_mode_context, build_language_directive, language_name

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)-6s %(levelname)-5s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("main")

# Strict action extractor: must be a JSON object on its OWN line at the very
# END of the reply, using double-quoted "action". This prevents the LLM from
# accidentally triggering hardware (SOS, music, meds) whenever it mentions
# an action word mid-sentence or emits stray brace-y text.
ACTION_RE = re.compile(
    r"(?:^|\n)\s*(\{\s*\"action\"\s*:\s*\"[a-z_]+\"[^{}\n]*\})\s*\Z",
    re.S,
)
ALLOWED_ACTIONS = {"trigger_sos", "set_medication", "play_music", "start_exercise"}
# For destructive/attention-grabbing actions we additionally require the
# user's own last message to contain an intent keyword — the LLM cannot
# fire SOS just because it decided the moment felt heavy.
SOS_KEYWORDS = re.compile(r"\b(sos|emergency|help me|call.*(help|ambulance|police)|"
                          r"kill myself|suicid|self.?harm|hurt myself)\b", re.I)

# Menu shown to the user in debug mode and used to validate `mode_set`.
MODES = [
    ("ANXIETY",       "Panic attacks, GAD, social anxiety, stress"),
    ("DEPRESSION",    "Emotional support, mood, behavioural activation"),
    ("PTSD",          "Grounding, safety, trigger management"),
    ("ADHD",          "Task reminders, focus, routine building"),
    ("BIPOLAR",       "Mood tracking, wellness check-ins, early warning"),
    ("SCHIZOPHRENIA", "Reality-orienting, med adherence, low sensory load"),
    ("GENERAL",       "Everyday companion"),
]

LANGUAGES = [
    ("en", "English"),
    ("es", "Spanish"),
    ("fr", "French"),
    ("de", "German"),
    ("pt", "Portuguese"),
    ("ha", "Hausa"),
    ("yo", "Yoruba"),
    ("ig", "Igbo"),
    ("sw", "Swahili"),
    ("ar", "Arabic"),
    ("hi", "Hindi"),
    ("zh", "Mandarin"),
]

PIPELINES = [
    ("local",  "Local only — offline, private, always works"),
    ("auto",   "Auto — cloud when online, falls back to local"),
    ("cloud",  "Cloud preferred — force cloud when possible"),
]


class MindBuddy:

    def __init__(self, debug=False):
        self.debug = debug

        if not debug:
            self.audio = AudioIO(CFG.alsa_in, CFG.alsa_out, CFG.sample_rate)
            self.sync  = SupabaseSync(CFG.supabase_url, CFG.supabase_key,
                                      CFG.device_code, self._on_supabase_state)
            self.link  = PiLink(CFG.serial_port, CFG.serial_baud, self._on_lg_msg)
        else:
            self.audio = None
            self.sync = None
            self.link = None

        self.stt   = LocalSTT(CFG.whisper_model, CFG.sample_rate)
        self.llm   = HybridLLM(
            CFG.local_llm_path,
            CFG.local_llm_threads,
            CFG.local_llm_ctx,
            CFG.groq_api_key,
            CFG.groq_model,
        )
        self.tts   = HybridTTS(
            CFG.piper_voice,
            CFG.openai_api_key,
            CFG.openai_tts_model,
            CFG.openai_tts_voice,
        )

        self.mode = CFG.default_mode
        self.language = CFG.default_language
        self.pipeline_pref = CFG.default_pipeline
        self.history: List[Dict] = []
        self.in_call = False
        self.online = False
        # Default to LOCAL server; auto-mode flips to cloud only when the
        # online watcher confirms network is up.
        self.cloud_pref = self.pipeline_pref != "local"
        self.stop = threading.Event()
        self.turn_q: queue.Queue[str] = queue.Queue()
        # medication scheduler bookkeeping: (hour, minute, date-string) fired
        self._med_fired: set[tuple[int, int, str]] = set()

    # --------------- lifecycle ---------------
    def run(self):
        self.audio.start_capture(); self.audio.set_volume(CFG.default_volume)
        self.link.start(); self.sync.start()
        signal.signal(signal.SIGINT, lambda *_: self.stop.set())
        signal.signal(signal.SIGTERM, lambda *_: self.stop.set())
        threading.Thread(target=self._wake_loop,  daemon=True).start()
        threading.Thread(target=self._turn_loop,  daemon=True).start()
        threading.Thread(target=self._med_loop,   daemon=True).start()
        self._push_state()
        log.info("ready (mode=%s language=%s)", self.mode, self.language)
        # MindBuddy opens the conversation so the user hears something first.
        self._greet_user()
        while not self.stop.is_set(): time.sleep(0.5)
        self.link.stop(); self.audio.stop_capture()

    def _greet_user(self):
        opener = (
            "INTERNAL EVENT: a new session just started. The user has selected "
            f"mode={self.mode} and language={language_name(self.language)}. "
            "Greet them warmly in 1-2 short sentences appropriate for this mode, "
            "and invite them to share how they're feeling. Plain reply only."
        )
        self.turn_q.put(opener)

    # --------------- link ---------------
    def _on_lg_msg(self, m: dict):
        t = m.get("type")
        if t == "ping":              self.link.send({"type": "pong"})
        elif t == "boot":            log.info("lg boot: %s", m)
        elif t == "mode_set":        self._set_mode(m.get("mode", "ANXIETY"))
        elif t == "language_set":    self._set_language(m.get("language", "en"))
        elif t == "sound_set":       pass  # audio.mute could hook here
        elif t == "voice_set":       self.tts.set_voice(m.get("voice", "female"))
        elif t == "volume_set":      self.audio.set_volume(int(m.get("volume", 70)))
        elif t == "cloud_toggle":    self._set_cloud(bool(m.get("cloud", True)))
        elif t == "pipeline_set":    self._set_pipeline(m.get("pipeline", "auto"))
        elif t == "tts_engine_set":  self.tts.set_local_engine(m.get("engine", "kokoro"))
        elif t == "net_status":      self._set_online(bool(m.get("online", False)))
        elif t == "call_incoming" or t == "call_answered": self._enter_call()
        elif t == "call_ended":      self._leave_call()
        elif t == "sos_trigger":     self._handle_sos(m.get("note", ""))
        elif t == "wake":            self.turn_q.put("__wake__")
        elif t == "text_prompt":     self.turn_q.put(m.get("text", ""))
        elif t == "music_cmd":       log.info("music cmd %s (TODO: player)", m)

    # --------------- supabase ---------------
    def _on_supabase_state(self, s: dict):
        mode = s.get("mode")
        if mode and mode != self.mode: self._set_mode(mode)
        lang = s.get("language")
        if lang and lang != self.language: self._set_language(lang)
        vol = s.get("speaker_volume")
        if isinstance(vol, int): self.audio.set_volume(vol)
        voice = s.get("preferred_voice")
        if voice: self.tts.set_voice(voice)
        # forward useful bits to LilyGo
        self.link.send({"type": "meds", "items": s.get("meds", [])})
        self.link.send({"type": "sos_state", "active": bool(s.get("sos_active"))})

    # --------------- helpers ---------------
    def _set_mode(self, m: str):
        self.mode = (m or "ANXIETY").upper()
        self.history.clear()
        if self.link: self.link.send({"type": "mode", "mode": self.mode})
        if self.sync: self.sync.push({"mode": self.mode})
        log.info("mode -> %s", self.mode)

    def _set_language(self, lang: str):
        self.language = (lang or "en").lower().strip()
        self.history.clear()
        if self.link: self.link.send({"type": "language", "language": self.language})
        if self.sync: self.sync.push({"language": self.language})
        log.info("language -> %s (%s)", self.language, language_name(self.language))

    def _set_cloud(self, cloud: bool):
        self.cloud_pref = cloud
        self.llm.set_cloud_allowed(cloud)
        self.tts.set_cloud_allowed(cloud)
        self._push_state()

    def _set_pipeline(self, pipeline: str):
        p = (pipeline or "auto").lower()
        # Accept new names (local/auto/cloud) and the legacy TFT value
        # ("offline"). "auto" prefers cloud but the online watcher decides.
        cloud = p not in ("offline", "local")
        self.pipeline_pref = p
        self._set_cloud(cloud)

    def _set_online(self, online: bool):
        self.online = online
        if online: self.llm.mark_cloud_ok()
        else:      self.llm.mark_cloud_bad()
        self._push_state()

    def _push_state(self):
        if not self.link: return
        self.link.send({"type": "state", "listening": False, "thinking": False,
                        "speaking": False,
                        "backend": "cloud" if (self.online and self.cloud_pref and self.llm.has_cloud()) else "local"})

    def _enter_call(self):
        if self.in_call: return
        self.in_call = True
        log.info("call started - releasing audio")
        self.audio.stop_playback(); self.audio.pause(); self.audio.stop_capture()

    def _leave_call(self):
        if not self.in_call: return
        self.in_call = False
        log.info("call ended - reclaiming audio")
        self.audio.start_capture(); self.audio.resume()

    def _handle_sos(self, note: str):
        log.warning("SOS: %s", note)
        if self.sync: self.sync.sos(note or "SOS from device")
        if self.audio:
            self.audio.beep(1000, 200); self.audio.beep(700, 200); self.audio.beep(1000, 300)

    # --------------- medication scheduler ---------------
    def _med_loop(self):
        """Tick once a minute. Fire a warm reminder when a med time hits.

        Reads app-state meds already pushed from Supabase (via _on_supabase_state
        -> link 'meds' forwarding). Keeps its own copy so we don't leak state
        into the link module.
        """
        while not self.stop.is_set():
            time.sleep(20)
            if self.in_call: continue
            meds = getattr(self, "_meds_cache", None) or []
            if not meds: continue
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")
            for m in meds:
                try:
                    if not m.get("enabled", True): continue
                    h = int(m.get("hour", 0)); mi = int(m.get("minute", 0))
                    if now.hour == h and now.minute == mi:
                        key = (h, mi, today)
                        if key in self._med_fired: continue
                        self._med_fired.add(key)
                        label = str(m.get("label") or "your medication")
                        self._fire_medication_reminder(label, h, mi)
                except Exception as e:
                    log.warning("med schedule error: %s", e)

    def _fire_medication_reminder(self, label: str, h: int, mi: int):
        log.info("MED reminder: %s @ %02d:%02d", label, h, mi)
        prompt = (
            f"INTERNAL EVENT: it is {h:02d}:{mi:02d}, time for the user's "
            f"medication ({label}). Speak DIRECTLY to them in 1-2 short warm "
            f"sentences, encouraging them to take it now with water. Do not "
            f"invent a dose. Plain reply only."
        )
        self.turn_q.put(prompt)

    # --------------- wake ---------------
    def _wake_loop(self):
        """Rolling 1.5 s window; if wake phrase detected, hand off to turn loop."""
        window_s = 1.5; frames_per_window = int(CFG.sample_rate * window_s)
        buf = []
        while not self.stop.is_set():
            if self.in_call: time.sleep(0.2); continue
            chunk = self.audio.read_seconds(0.3)
            if chunk.size == 0: continue
            buf.append(chunk)
            if sum(len(b) for b in buf) < frames_per_window: continue
            import numpy as np
            window = np.concatenate(buf)[-frames_per_window:]; buf = [window[-frames_per_window//2:]]
            text = self.stt.transcribe(window).lower()
            if CFG.wake_phrase and CFG.wake_phrase in text:
                log.info("wake matched: %r", text)
                self.audio.beep(880, 90)
                self.turn_q.put("__wake__")

    # --------------- turn ---------------
    def _build_system_message(self) -> Dict:
        content = "\n\n".join([
            SYSTEM_PROMPT,
            build_mode_context(self.mode),
            build_language_directive(self.language),
        ])
        return {"role": "system", "content": content}

    def _turn_loop(self):
        while not self.stop.is_set():
            try: item = self.turn_q.get(timeout=0.5)
            except queue.Empty: continue
            if self.in_call: continue

            if item == "__wake__":
                self.link.send({"type": "state", "listening": True, "thinking": False, "speaking": False})
                utt = self.stt.wait_for_speech(self._frame_iter())
                text = self.stt.transcribe(utt).strip() if utt.size else ""
            else:
                text = item.strip()

            if not text:
                self._push_state(); continue

            if self.link: self.link.send({"type": "chat_user", "text": text})
            if self.link:
                self.link.send({"type": "state", "listening": False, "thinking": True, "speaking": False,
                                "backend": "cloud" if (self.online and self.cloud_pref and self.llm.has_cloud()) else "local"})

            self.history.append({"role": "user", "content": text})
            self.history = self.history[-10:]
            messages = [self._build_system_message(), *self.history]
            prefer_cloud = self.online and self.cloud_pref
            backend = "cloud" if (prefer_cloud and self.llm.has_cloud()) else "local"
            t0 = time.time()
            try: reply = self.llm.chat(messages, prefer_cloud=prefer_cloud)
            except Exception as e:
                log.exception("llm error: %s", e); reply = "I'm having trouble thinking right now."
            elapsed_ms = int((time.time() - t0) * 1000)
            log.info("llm reply in %d ms via %s (pipeline=%s)", elapsed_ms, backend, self.pipeline_pref)

            reply, action = self._extract_action(reply, user_text=text)
            self.history.append({"role": "assistant", "content": reply})
            if self.link:
                self.link.send({"type": "chat_ai_final", "text": reply,
                                "elapsed_ms": elapsed_ms, "backend": backend})
                self.link.send({"type": "chat_ai_meta", "elapsed_ms": elapsed_ms,
                                "backend": backend, "pipeline": self.pipeline_pref})

            # STT and TTS are ALWAYS local — pipeline setting only routes the
            # LLM. This keeps voice latency low and predictable regardless of
            # network state.
            if self.link:
                self.link.send({"type": "state", "listening": False, "thinking": False, "speaking": True,
                                "backend": "cloud" if prefer_cloud and self.llm.has_cloud() else "local"})
            try:
                pcm, sr = self.tts.synth(reply, prefer_cloud=False)
                if pcm.size and self.audio: self.audio.play_pcm(pcm, sr, blocking=True)
            except Exception as e: log.warning("tts error: %s", e)

            if action: self._act(action)
            self._push_state()

    def _frame_iter(self):
        import numpy as np
        idle_deadline = time.time() + 2.0
        while time.time() < idle_deadline and not self.in_call:
            chunk = self.audio.read_seconds(0.03)
            if chunk.size:
                idle_deadline = time.time() + 2.0
                yield chunk

    def _extract_action(self, reply: str, user_text: str = ""):
        """Pull a trailing {"action":"..."} tag off the reply, if it's real.

        Rules that keep the LLM from spuriously triggering hardware:
        - The JSON must be the LAST thing in the reply, on its own line.
        - The `action` value must be in ALLOWED_ACTIONS.
        - `trigger_sos` requires the user's own message to contain a crisis
          keyword (help me, emergency, suicide, self-harm, ...). Otherwise
          the tag is stripped from speech but NOT executed.
        Any tag we detect is always removed from the spoken reply.
        """
        m = ACTION_RE.search(reply)
        if not m: return reply, None
        cleaned = reply[: m.start()].rstrip()
        try:
            action = json.loads(m.group(1))
        except Exception:
            return cleaned, None
        kind = action.get("action")
        if kind not in ALLOWED_ACTIONS:
            log.info("dropping unknown action tag: %s", action)
            return cleaned, None
        if kind == "trigger_sos" and not SOS_KEYWORDS.search(user_text or ""):
            log.info("suppressing trigger_sos — no crisis keyword in user text: %r", user_text)
            return cleaned, None
        return cleaned, action

    def _act(self, a: dict):
        kind = a.get("action")
        log.info("action %s: %s", kind, a)
        if kind == "trigger_sos":
            self._handle_sos("triggered by voice")
        elif kind == "set_medication":
            if self.sync:
                self.sync.push({"med": {"hour": int(a.get("hour", 20)),
                                        "minute": int(a.get("minute", 0)),
                                        "enabled": bool(a.get("enabled", True))}})
        elif kind == "play_music":
            if self.link:
                self.link.send({"type": "music_state", "playing": True,
                                "title": a.get("query", ""), "artist": ""})

    # --------------- debug REPL ---------------
    def run_debug(self):
        print("\n==============================")
        print(" MindBuddy Debug Mode")
        print("==============================\n")
        self._debug_pick_mode()
        self._debug_pick_language()
        self._debug_pick_pipeline()
        print(f"\nReady - mode={self.mode}, language={language_name(self.language)}, "
              f"pipeline={self.pipeline_pref}")
        print("Type 'mode' to change mode, 'lang' to change language,")
        print("'pipe' to change pipeline, 'exit' to quit.\n")
        # MindBuddy initiates the conversation.
        self._debug_greet()

        while True:
            try:
                text = input("You: ").strip()
                if not text: continue
                low = text.lower()
                if low in ("exit", "quit"): print("Goodbye."); break
                if low == "mode":  self._debug_pick_mode();     continue
                if low == "lang":  self._debug_pick_language(); continue
                if low == "pipe":  self._debug_pick_pipeline(); continue

                self.history.append({"role": "user", "content": text})
                self.history = self.history[-10:]
                messages = [self._build_system_message(), *self.history]
                prefer_cloud = self.online and self.cloud_pref
                backend = "cloud" if (prefer_cloud and self.llm.has_cloud()) else "local"
                t0 = time.time()
                reply = self.llm.chat(messages, prefer_cloud=prefer_cloud)
                elapsed_ms = int((time.time() - t0) * 1000)
                reply, action = self._extract_action(reply, user_text=text)
                self.history.append({"role": "assistant", "content": reply})
                print(f"\nMindBuddy [{backend} \u00b7 {elapsed_ms} ms \u00b7 pipe={self.pipeline_pref}]:")
                print(reply)
                if action:
                    print("\n[Action]", action)
                print()
            except KeyboardInterrupt:
                print("\nExiting debug mode."); break
            except Exception as e:
                print("\nError:", e)

    def _debug_pick_mode(self):
        print("Which support mode? Enter a number:")
        for i, (code, desc) in enumerate(MODES, 1):
            print(f"  {i}. {code:<14} - {desc}")
        while True:
            raw = input(f"Mode [1-{len(MODES)}] (default {self.mode}): ").strip()
            if not raw:
                print(f"-> keeping mode = {self.mode}"); return
            try:
                idx = int(raw)
                if 1 <= idx <= len(MODES):
                    self.mode = MODES[idx - 1][0]
                    self.history.clear()
                    print(f"-> mode = {self.mode}"); return
            except ValueError: pass
            print("Please enter a valid number.")

    def _debug_pick_language(self):
        print("\nWhich language should MindBuddy reply in?")
        for i, (code, name) in enumerate(LANGUAGES, 1):
            print(f"  {i:2}. {name} ({code})")
        while True:
            raw = input(f"Language [1-{len(LANGUAGES)}] "
                        f"(default {language_name(self.language)}): ").strip()
            if not raw:
                print(f"-> keeping language = {language_name(self.language)}"); return
            try:
                idx = int(raw)
                if 1 <= idx <= len(LANGUAGES):
                    self.language = LANGUAGES[idx - 1][0]
                    self.history.clear()
                    print(f"-> language = {language_name(self.language)}"); return
            except ValueError: pass
            print("Please enter a valid number.")

    def _debug_pick_pipeline(self):
        print("\nWhich AI pipeline should MindBuddy use?")
        for i, (code, desc) in enumerate(PIPELINES, 1):
            print(f"  {i}. {code:<6} - {desc}")
        while True:
            raw = input(f"Pipeline [1-{len(PIPELINES)}] "
                        f"(default {self.pipeline_pref}): ").strip()
            if not raw:
                self._set_pipeline(self.pipeline_pref)
                print(f"-> keeping pipeline = {self.pipeline_pref}"); return
            try:
                idx = int(raw)
                if 1 <= idx <= len(PIPELINES):
                    choice = PIPELINES[idx - 1][0]
                    self._set_pipeline(choice)
                    print(f"-> pipeline = {choice}"); return
            except ValueError: pass
            print("Please enter a valid number.")

    def _debug_greet(self):
        """MindBuddy opens the conversation after mode/language/pipeline are set."""
        opener = (
            "INTERNAL EVENT: a new session just started. The user has selected "
            f"mode={self.mode} and language={language_name(self.language)}. "
            "Greet them warmly in 1-2 short sentences appropriate for this mode, "
            "and invite them to share how they're feeling. Plain reply only."
        )
        try:
            messages = [self._build_system_message(),
                        {"role": "user", "content": opener}]
            prefer_cloud = self.online and self.cloud_pref
            reply = self.llm.chat(messages, prefer_cloud=prefer_cloud)
            reply, _ = self._extract_action(reply)
            self.history.append({"role": "assistant", "content": reply})
            print("\nMindBuddy:", reply, "\n")
        except Exception as e:
            print("\n[greet failed]", e)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true",
                        help="Run without audio and hardware")
    args = parser.parse_args()
    app = MindBuddy(debug=args.debug)
    if args.debug: app.run_debug()
    else:          app.run()


if __name__ == "__main__":
    main()
