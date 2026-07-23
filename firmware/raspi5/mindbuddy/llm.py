"""Hybrid LLM: local llama.cpp always warm, Groq cloud when available and allowed.

This module is the single guarantor of the "counselor voice" for the model:
even if a caller forgets to prepend the system prompt, `chat()` injects a
compact style reminder (short sentences, ellipsis pauses, optional emotion
tags, no clinical "I'm sorry you're feeling..." openers) and lightly
post-processes the reply so Piper/Kokoro deliver it with natural rhythm.

Pipeline behaviour (mirrors the TFT switch on the LilyGO):
    * `prefer_cloud=True`  -> try Groq; on failure fall back to local.
    * `prefer_cloud=False` -> local only.
    * The Pi is expected to force offline mode only when network/cloud
      health is bad; `mark_cloud_bad()` / `mark_cloud_ok()` let the main
      loop track that without changing user preference.
"""
from __future__ import annotations
import logging, re, threading, time
from typing import List, Dict
import requests

log = logging.getLogger("llm")

# Compact voice reminder — injected into the system message if the caller
# didn't already include the full SYSTEM_PROMPT from prompts.py. Kept short
# so it costs almost no context on the local model.
_VOICE_REMINDER = (
    "Speak like a warm human counselor, not a chatbot. "
    "Never open with 'I'm sorry you're feeling...' or 'As an AI'. "
    "Reply in 1-3 short sentences, ONE sentence per line. "
    "Use ellipses ('...') inside a sentence for gentle pauses. "
    "You may start with a soft filler like 'Hmm...', 'I see...', 'Okay...' — at most one. "
    "You may prefix a line with an emotion tag on its own line: "
    "<soft> / <calm> / <warm> / <excited>. Tags steer the voice."
)

_HAS_TAG = re.compile(r"<\s*(soft|calm|warm|excited|neutral)\s*>", re.I)
_SENT_SPLIT = re.compile(r"(?<=[\.\!\?])\s+")
_BAD_OPENERS = re.compile(
    r"^\s*(i'm sorry (you'?re|that you'?re) feeling|as an ai|i am an ai|"
    r"i understand that you'?re feeling)",
    re.I,
)


class HybridLLM:
    def __init__(self, local_path: str, threads: int, ctx: int,
                 groq_key: str = "", groq_model: str = "llama-3.1-8b-instant"):
        self.groq_key = groq_key
        self.groq_model = groq_model
        self.cloud_allowed = True
        self._cloud_bad_until = 0.0   # unix ts; while > now, skip cloud
        self._local = None
        self._local_lock = threading.Lock()
        self._local_path = local_path
        self._local_threads = threads
        self._local_ctx = ctx
        loader = threading.Thread(target=self._load_local)
        loader.start()
        loader.join()

    def _load_local(self):
        try:
            from llama_cpp import Llama
            log.info("loading local llm %s", self._local_path)
            self._local = Llama(
                model_path=self._local_path,
                n_ctx=self._local_ctx,
                n_threads=self._local_threads,
                n_batch=256,
                use_mlock=True,
                verbose=False,
                chat_format="llama-3",
            )
            log.info("local llm ready")
            log.info("warming local llm...")
            try:
                # Warm with a realistic shape: system + user + short generation.
                # This forces every kernel (prompt-eval + decode) to compile
                # so the first real turn isn't a 20-second cold-start.
                self._local.create_chat_completion(
                    messages=[
                        {"role": "system", "content":
                         "You are a warm counselor. Reply in one short sentence."},
                        {"role": "user", "content": "Say hello."},
                    ],
                    max_tokens=16, temperature=0,
                )
                log.info("local llm warmed")
            except Exception as e:
                log.warning("warm-up failed: %s", e)
        except Exception as e:
            log.error("local llm load failed: %s", e)
            self._local = None

    # ---- runtime controls ---------------------------------------------
    def set_cloud_allowed(self, allowed: bool): self.cloud_allowed = bool(allowed)
    def has_cloud(self) -> bool:
        return (
            bool(self.groq_key)
            and self.cloud_allowed
            and time.time() >= self._cloud_bad_until
        )
    def local_ready(self) -> bool: return self._local is not None

    def mark_cloud_bad(self, cooldown_s: float = 30.0):
        """Called by main loop when network/cloud check fails."""
        self._cloud_bad_until = time.time() + cooldown_s

    def mark_cloud_ok(self): self._cloud_bad_until = 0.0

    def active_backend(self, prefer_cloud: bool) -> str:
        return "cloud" if (prefer_cloud and self.has_cloud()) else "local"

    # ---- unified call -------------------------------------------------
    def chat(self, messages: List[Dict], *, prefer_cloud: bool,
             max_tokens: int = 160, temperature: float = 0.7) -> str:
        messages = self._ensure_voice_system(messages)
        if prefer_cloud and self.has_cloud():
            try:
                reply = self._chat_cloud(messages, max_tokens, temperature)
                self.mark_cloud_ok()
                return self._humanize(reply)
            except Exception as e:
                log.warning("cloud failed, falling back to local: %s", e)
                self.mark_cloud_bad()
        return self._humanize(self._chat_local(messages, max_tokens, temperature))

    # ---- internals ----------------------------------------------------
    @staticmethod
    def _ensure_voice_system(messages: List[Dict]) -> List[Dict]:
        """Guarantee the counselor-voice guidance is present in the system slot."""
        if messages and messages[0].get("role") == "system":
            sys_content = messages[0].get("content", "") or ""
            if "counselor" not in sys_content.lower() and "<soft>" not in sys_content:
                # Caller passed a minimal / unrelated system prompt — append style block.
                messages = list(messages)
                messages[0] = {
                    "role": "system",
                    "content": sys_content.rstrip() + "\n\n" + _VOICE_REMINDER,
                }
            return messages
        return [{"role": "system", "content": _VOICE_REMINDER}, *messages]

    @staticmethod
    def _humanize(reply: str) -> str:
        """Light post-processing so TTS sounds calmer even if the model was terse.

        - Strip clinical openers ("I'm sorry you're feeling..." / "As an AI...").
        - Put each sentence on its own line (Piper/Kokoro treat newlines as pauses).
        - Convert " - " / em-dash into ellipsis for a softer beat.
        Emotion tags and existing line breaks are preserved.
        """
        reply = (reply or "").strip()
        if not reply: return reply

        # Drop a single leading bad-opener sentence if present.
        first, _, rest = reply.partition("\n")
        if _BAD_OPENERS.match(first):
            # Try to keep the rest; if empty, replace with a gentle default.
            reply = rest.strip() or "Hmm... I hear you. I'm right here with you."

        # Preserve emotion tag lines — split on those first so we don't merge tags into sentences.
        out_lines: list[str] = []
        for block in reply.split("\n"):
            block = block.strip()
            if not block:
                continue
            if _HAS_TAG.fullmatch(block):
                out_lines.append(block); continue
            # Soften harsh dashes into ellipsis pauses.
            block = re.sub(r"\s+[—–-]\s+", "... ", block)
            # One sentence per line.
            for sent in _SENT_SPLIT.split(block):
                sent = sent.strip()
                if sent: out_lines.append(sent)
        return "\n".join(out_lines)

    def _chat_cloud(self, messages, max_tokens, temperature) -> str:
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.groq_key}",
                     "Content-Type": "application/json"},
            json={"model": self.groq_model, "messages": messages,
                  "max_tokens": max_tokens, "temperature": temperature},
            timeout=25,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()

    def _chat_local(self, messages, max_tokens, temperature) -> str:
        with self._local_lock:
            if not self._local:
                return "I'm still waking up... give me a moment and try again."
            out = self._local.create_chat_completion(
                messages=messages, max_tokens=max_tokens, temperature=temperature,
            )
        return out["choices"][0]["message"]["content"].strip()
