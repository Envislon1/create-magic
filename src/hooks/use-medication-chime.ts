import { useCallback, useEffect, useRef } from "react";

type PlayOptions = {
  /** Total duration in ms (default 60s). */
  durationMs?: number;
  /** When false the chime is silenced (still vibrates). */
  enabled?: boolean;
  /** 0..100 speaker volume. */
  volume?: number;
};

// Soft 3-note bell pattern (C6 → E6 → G6) for medication reminders.
// Deliberately distinct from the SOS siren so users can tell them apart
// without looking at the screen. Loops every ~4 seconds with a gentle
// vibration pulse.
export function useMedicationChime() {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const vibrateTimerRef = useRef<number | null>(null);
  const playingRef = useRef(false);

  const stop = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (stopTimerRef.current) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (vibrateTimerRef.current) {
      window.clearInterval(vibrateTimerRef.current);
      vibrateTimerRef.current = null;
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(0);
    }
  }, []);

  const playChimeOnce = useCallback((volume: number) => {
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = ctxRef.current ?? new AC();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();

      const notes = [1046.5, 1318.5, 1568]; // C6, E6, G6
      const noteDur = 0.22;
      const gap = 0.04;
      const peak = (volume / 100) * 0.25;
      const now = ctx.currentTime;

      notes.forEach((freq, i) => {
        const start = now + i * (noteDur + gap);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        // Soft bell envelope: quick attack, slow decay.
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          start + noteDur,
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + noteDur + 0.02);
      });
    } catch (err) {
      console.warn("[medchime] play failed", err);
    }
  }, []);

  const play = useCallback(
    (arg: number | PlayOptions = 60_000) => {
      const opts: PlayOptions =
        typeof arg === "number" ? { durationMs: arg } : arg;
      const durationMs = opts.durationMs ?? 60_000;
      const enabled = opts.enabled ?? true;
      const volume = Math.max(0, Math.min(100, opts.volume ?? 70));

      if (typeof window === "undefined") return;
      if (playingRef.current) return;
      playingRef.current = true;

      // Gentle pulse — clearly different from the SOS pattern.
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        const pattern = [200, 150, 200];
        navigator.vibrate(pattern);
        vibrateTimerRef.current = window.setInterval(() => {
          navigator.vibrate(pattern);
        }, 4000);
      }

      if (enabled && volume > 0) {
        playChimeOnce(volume);
        intervalRef.current = window.setInterval(() => {
          playChimeOnce(volume);
        }, 4000);
      }

      stopTimerRef.current = window.setTimeout(() => stop(), durationMs);
    },
    [playChimeOnce, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { play, stop };
}
