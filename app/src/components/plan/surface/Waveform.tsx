'use client';

/**
 * Waveform.tsx — a live meter over the microphone, and the one job it has.
 *
 * It lets the client tell *“not listening”* from *“listening, you haven’t said anything yet”*.
 * That distinction is the whole reason the element exists, so it FLATLINES when silent and peaks
 * while speaking rather than idling with a decorative animation — a waveform that moves when
 * nothing is being heard is worse than none, because it answers the question wrongly.
 *
 * ── How ──────────────────────────────────────────────────────────────────────────────
 *
 * `getUserMedia({audio})` → `AnalyserNode` → `getByteFrequencyData` into BARS values on
 * `requestAnimationFrame`. The bars are written straight to the DOM through refs, never through
 * state: a rAF loop through `setState` re-renders the sheet — its framing copy, its prompts, its
 * submit — sixty times a second while somebody is talking.
 *
 * The stream is a SECOND consumer of the microphone: `useSpeechInput` holds its own through the
 * Web Speech API. Browsers allow that, and the two are deliberately independent — the transcript
 * must keep working if the meter fails, which it does on any browser without `AudioContext`.
 * Every failure path here ends in "no bars", never in "no capture".
 *
 * ── What it reports upward ───────────────────────────────────────────────────────────
 *
 * `onLevel(loud)` — whether anything is being heard right now, debounced by SILENCE_MS so a gap
 * between words is not a state change. The sheet uses it for the copy and the mic's own
 * treatment, because X6 is explicit: silent and speaking must differ by more than the bars.
 *
 * `prefers-reduced-motion` holds the bars at a static mid height. The state is still carried —
 * by the heading, the body line and the mic — so nothing is lost by not animating.
 */
import React, { useEffect, useRef } from 'react';

/** Bars across the meter. 25 at 350px is ~10px each including the gap. */
const BARS = 25;
/** Below this mean amplitude (0–255) the room is silent. Chosen to sit above room tone. */
const SILENCE_FLOOR = 12;
/** How long silence has to hold before it counts. A gap between words is not silence. */
const SILENCE_MS = 450;
/** The bar height when nothing is heard, and the flat line reduced motion holds. */
const FLATLINE_PCT = 6;

export function Waveform({
  active, onLevel,
}: {
  /** True while capturing. False tears the stream down — a microphone must stop when it says
   *  it has stopped, and holding it open is the one bug in this file nobody would see. */
  active: boolean;
  onLevel?: ((loud: boolean) => void) | undefined;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const onLevelRef = useRef(onLevel);
  onLevelRef.current = onLevel;

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;
    let loud = false;
    let quietSince = 0;

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const paint = (heights: number[]) => {
      for (let i = 0; i < BARS; i++) {
        const el = bars.current[i];
        if (el) el.style.height = `${heights[i] ?? FLATLINE_PCT}%`;
      }
    };

    if (reduced) {
      paint(Array.from({ length: BARS }, () => 34));
      return;
    }

    (async () => {
      try {
        const media = navigator.mediaDevices;
        if (!media?.getUserMedia) return;
        stream = await media.getUserMedia({ audio: true });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }

        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const step = Math.max(1, Math.floor(data.length / BARS));

        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          const heights: number[] = [];
          for (let i = 0; i < BARS; i++) {
            let band = 0;
            for (let j = 0; j < step; j++) band = Math.max(band, data[i * step + j] ?? 0);
            sum += band;
            // Flat when silent, and never below the flatline: a bar of zero height reads as a
            // broken element rather than as quiet.
            heights.push(band < SILENCE_FLOOR ? FLATLINE_PCT : Math.min(100, FLATLINE_PCT + (band / 255) * 94));
          }
          paint(heights);

          const now = performance.now();
          const heard = sum / BARS >= SILENCE_FLOOR;
          if (heard) { quietSince = 0; if (!loud) { loud = true; onLevelRef.current?.(true); } }
          else {
            if (!quietSince) quietSince = now;
            if (loud && now - quietSince >= SILENCE_MS) { loud = false; onLevelRef.current?.(false); }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // No permission, no device, no AudioContext: no bars. Capture is a separate path and
        // reports its own failures — this one must not claim the microphone is broken.
      }
    })();

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      onLevelRef.current?.(false);
    };
  }, [active]);

  return (
    <div
      data-testid="waveform" data-active={active ? 'true' : undefined} aria-hidden="true"
      className="flex h-[54px] w-full items-center justify-center gap-[3px]"
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => { bars.current[i] = el; }}
          style={{ height: `${FLATLINE_PCT}%` }}
          // accent-600 is a NON-TEXT use here — nothing sits on the bars, which is exactly the
          // tier's job (DESIGN.md → Colors). The transition smooths the rAF steps without
          // becoming an animation of its own.
          className="w-[6px] flex-none rounded-full bg-coral-600 transition-[height] duration-100 ease-out"
        />
      ))}
    </div>
  );
}
