import { useCallback, useEffect, useRef } from "react";

type SpeakOptions = {
  voice?: "female" | "male" | string;
  /** 0..100 */
  volume?: number;
  enabled?: boolean;
};

function pickVoice(voices: SpeechSynthesisVoice[], pref: string) {
  if (!voices.length) return null;
  const enVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = enVoices.length ? enVoices : voices;
  const wantMale = pref === "male";
  // Common male voice name hints across platforms.
  const maleHints = /male|david|daniel|alex|fred|george|mark|james|tom|aaron|guy/i;
  const femaleHints = /female|samantha|victoria|karen|tessa|moira|fiona|susan|allison|ava|zira|jenny/i;
  const match = pool.find((v) =>
    wantMale ? maleHints.test(v.name) : femaleHints.test(v.name),
  );
  return match ?? pool[0];
}

// Speaks assistant text using the browser SpeechSynthesis API, honoring
// the user's preferred voice + speaker volume + sound-enabled toggle.
export function useSpeech() {
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const keepAliveRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (keepAliveRef.current) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback((text: string, opts: SpeakOptions = {}) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const enabled = opts.enabled ?? true;
    const volume = Math.max(0, Math.min(100, opts.volume ?? 70));
    if (!enabled || volume === 0 || !text.trim()) return;
    try {
      if (keepAliveRef.current) {
        window.clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
      window.speechSynthesis.cancel();

      // Chromium SpeechSynthesis is known to clip the final word(s) of an
      // utterance. Two mitigations together fix it reliably:
      //  1) Pad text with trailing punctuation + spaces so any cutoff lands
      //     in silence instead of mid-syllable ("Hello, buddy" -> heard fully).
      //  2) Periodic pause()/resume() keep-alive while speaking — prevents
      //     the engine going idle mid-sentence.
      const padded = `${text.trim().replace(/[.!?,;:]+$/, "")}.    `;
      const utter = new SpeechSynthesisUtterance(padded);
      const voice = pickVoice(voicesRef.current, opts.voice ?? "female");
      if (voice) utter.voice = voice;
      utter.volume = volume / 100;
      utter.rate = 1;
      utter.pitch = (opts.voice ?? "female") === "male" ? 0.9 : 1.1;

      const clearKeepAlive = () => {
        if (keepAliveRef.current) {
          window.clearInterval(keepAliveRef.current);
          keepAliveRef.current = null;
        }
      };
      utter.onend = clearKeepAlive;
      utter.onerror = clearKeepAlive;

      window.speechSynthesis.speak(utter);

      keepAliveRef.current = window.setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          clearKeepAlive();
          return;
        }
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 4000);
    } catch (err) {
      console.warn("[speech] speak failed", err);
    }
  }, []);

  return { speak, cancel };
}
