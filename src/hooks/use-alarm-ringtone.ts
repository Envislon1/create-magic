import { useCallback, useEffect, useRef } from "react";

type PlayOptions = {
  /** Duration in ms (default 20s). */
  durationMs?: number;
  /** When false the ringtone is silenced (still vibrates). */
  enabled?: boolean;
  /** 0..100 speaker volume. */
  volume?: number;
};

// Plays a loud, looping alarm tone via WebAudio and triggers continuous
// vibration so the user's phone "rings" even when the page is in the
// background. The browser must have been interacted with at least once
// for WebAudio autoplay to work — we resume the context on the first
// successful play.
export function useAlarmRingtone() {
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const lfoRef = useRef<OscillatorNode | null>(null);
  const vibrateTimerRef = useRef<number | null>(null);
  const playingRef = useRef(false);

  const stop = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    try {
      oscRef.current?.stop();
      lfoRef.current?.stop();
    } catch {}
    oscRef.current?.disconnect();
    lfoRef.current?.disconnect();
    gainRef.current?.disconnect();
    oscRef.current = null;
    lfoRef.current = null;
    gainRef.current = null;
    if (vibrateTimerRef.current) {
      window.clearInterval(vibrateTimerRef.current);
      vibrateTimerRef.current = null;
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(0);
    }
  }, []);

  const play = useCallback(
    (arg: number | PlayOptions = 20_000) => {
      const opts: PlayOptions =
        typeof arg === "number" ? { durationMs: arg } : arg;
      const durationMs = opts.durationMs ?? 20_000;
      const enabled = opts.enabled ?? true;
      const volume = Math.max(0, Math.min(100, opts.volume ?? 70));

      if (typeof window === "undefined") return;
      if (playingRef.current) return;

      // Vibrate even when muted so the user still gets a tactile alert.
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        const pattern = [600, 300, 600, 300, 600, 300];
        navigator.vibrate(pattern);
        vibrateTimerRef.current = window.setInterval(() => {
          navigator.vibrate(pattern);
        }, 3000);
        playingRef.current = true;
        window.setTimeout(() => stop(), durationMs);
      }

      if (!enabled || volume === 0) return;

      try {
        const AC =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = ctxRef.current ?? new AC();
        ctxRef.current = ctx;
        if (ctx.state === "suspended") void ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();

        osc.type = "square";
        osc.frequency.value = 880;
        // Scale 0..100 -> 0..0.35 max gain (avoid clipping).
        gain.gain.value = (volume / 100) * 0.35;

        // Siren effect: modulate frequency between 600 and 1000 Hz.
        lfo.type = "sine";
        lfo.frequency.value = 4; // 4 Hz wail
        lfoGain.gain.value = 200;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        lfo.start();
        oscRef.current = osc;
        lfoRef.current = lfo;
        gainRef.current = gain;
        playingRef.current = true;
      } catch (err) {
        console.warn("[ringtone] play failed", err);
      }
    },
    [stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { play, stop };
}
