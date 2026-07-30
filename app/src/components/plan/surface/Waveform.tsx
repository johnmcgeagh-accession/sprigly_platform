'use client';

/**
 * Waveform.tsx — a live meter over the microphone, and the one job it has.
 *
 * It lets the client tell *"not listening"* from *"listening, you haven't said anything yet"*.
 * That distinction is the whole reason the element exists, so it FLATLINES when silent and peaks
 * while speaking rather than idling with a decorative animation — a waveform that moves when
 * nothing is being heard is worse than none, because it answers the question wrongly.
 *
 * ── TWO SOURCES, AND WHY THERE HAD TO BE A SECOND ────────────────────────────────────
 *
 * This file used to say: *"The stream is a SECOND consumer of the microphone… Browsers allow
 * that, and the two are deliberately independent."* Chromium allows it. **iOS Safari does not.**
 * WebKit arbitrates one audio session per page, and opening `getUserMedia` while a
 * `SpeechRecognition` session is running interrupts the recognition — so the meter that exists
 * to prove we are listening was the thing stopping us from listening.
 *
 * The symptom is unmistakable once you know: "Listening…" on screen, a FLATLINE meter, and no
 * words. The flatline is the tell. It is not "we can hear nothing"; it is the analyser's own
 * stream having been interrupted by the same fight, so both consumers end up with silence.
 *
 *   ANALYSER  `getUserMedia` → `AnalyserNode` → real amplitude. Only where a second capture is
 *             established as safe (`audio-contention.ts` — Chromium, and nothing assumed).
 *   ACTIVITY  driven from the recogniser's OWN events (`onspeechstart` / `onspeechend` /
 *             `onresult`). No second stream at all.
 *
 * ── Is the activity meter honest? ────────────────────────────────────────────────────
 *
 * Yes, and arguably more so than the analyser. `speaking` comes from the recogniser reporting
 * that it has detected speech — which is the actual question the client is asking the meter
 * ("are my words getting in?"). The analyser answers a near-miss of that question: it shows
 * amplitude, so it rises for a passing lorry. What the activity meter cannot do is show the
 * SHAPE of a voice, so its bars are a travelling wave rather than a spectrum — deliberately
 * legible as an indicator rather than as a recording.
 *
 * What it must never do is move when nothing is being heard. It does not: `speaking` false
 * holds every bar at the flatline, exactly as the analyser does in a silent room.
 *
 * `prefers-reduced-motion` holds the bars at a static mid height in both modes. The state is
 * still carried — by the heading, the body line and the mic — so nothing is lost by not moving.
 */
import React, { useEffect, useRef } from 'react';
import { canRunTwoCaptures } from './audio-contention';
import { micTrace } from '../mic-trace';

/** Bars across the meter. 25 at 350px is ~10px each including the gap. */
const BARS = 25;
/** Below this mean amplitude (0–255) the room is silent. Chosen to sit above room tone. */
const SILENCE_FLOOR = 12;
/** How long silence has to hold before it counts. A gap between words is not silence. */
const SILENCE_MS = 450;
/** The bar height when nothing is heard, and the flat line reduced motion holds. */
const FLATLINE_PCT = 6;

export function Waveform({
  active, onLevel, speaking, pulse,
}: {
  /** True while capturing. False tears the stream down — a microphone must stop when it says
   *  it has stopped, and holding it open is the one bug in this file nobody would see. */
  active: boolean;
  onLevel?: ((loud: boolean) => void) | undefined;
  /**
   * The recogniser is hearing speech right now. Present → the meter runs in ACTIVITY mode on any
   * browser that cannot afford a second capture, and never opens a stream of its own.
   */
  speaking?: boolean | undefined;
  /** Bumped on every sign of life from the recogniser; makes the wave travel. */
  pulse?: number | undefined;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const onLevelRef = useRef(onLevel);
  onLevelRef.current = onLevel;

  // The decision is made once, here, so both effects agree about it and the trace records which
  // pipeline the device actually chose.
  const useAnalyser = speaking === undefined || canRunTwoCaptures();

  // ── ANALYSER MODE ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !useAnalyser) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let stopped = false;
    let loud = false;
    let quietSince = 0;
    let frames = 0;
    let nonZero = 0;

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
        micTrace('gum:open', 'meter');
        stream = await media.getUserMedia({ audio: true });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); micTrace('gum:close', 'meter (raced)'); return; }

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
            heights.push(band < SILENCE_FLOOR ? FLATLINE_PCT : Math.min(100, FLATLINE_PCT + (band / 255) * 94));
          }
          paint(heights);

          // Sampled, not per-tick: this is a rAF loop. It answers the one question a flatline
          // cannot — is the stream DEAD, or is the room quiet?
          frames += 1;
          if (sum > 0) nonZero += 1;
          if (frames % 120 === 0) micTrace('gum:frames', `${nonZero}/${frames} non-zero`);

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
        micTrace('gum:fail', 'meter');
      }
    })();

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      micTrace('gum:close', 'meter');
      onLevelRef.current?.(false);
    };
  }, [active, useAnalyser]);

  // ── ACTIVITY MODE ────────────────────────────────────────────────────────────────────
  // No stream, no AudioContext, no second consumer of anything. A travelling wave whose
  // amplitude is the recogniser's own `speaking`, so the bars move when and only when it is
  // hearing words. `pulse` advances the phase, which is what makes it read as live rather than
  // as a looping decoration: a pulse only arrives when something actually happened.
  useEffect(() => {
    if (!active || useAnalyser) return;
    micTrace('meter:activity', 'no second capture');

    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const paint = (heights: number[]) => {
      for (let i = 0; i < BARS; i++) {
        const el = bars.current[i];
        if (el) el.style.height = `${heights[i] ?? FLATLINE_PCT}%`;
      }
    };

    if (reduced) { paint(Array.from({ length: BARS }, () => 34)); return; }
    if (!speaking) { paint(Array.from({ length: BARS }, () => FLATLINE_PCT)); return; }

    let raf = 0;
    let phase = (pulse ?? 0) * 0.9;
    const tick = () => {
      phase += 0.16;
      const heights = Array.from({ length: BARS }, (_, i) => {
        // A wave that swells toward the middle, so it reads as a voice meter rather than a
        // progress bar. Two frequencies so it never looks mechanically periodic.
        const centre = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        const wave = 0.5 + 0.5 * Math.sin(phase - i * 0.45) * (0.6 + 0.4 * Math.sin(phase * 0.37 + i * 0.2));
        return FLATLINE_PCT + wave * (0.28 + 0.72 * centre) * 74;
      });
      paint(heights);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      paint(Array.from({ length: BARS }, () => FLATLINE_PCT));
    };
  }, [active, useAnalyser, speaking, pulse]);

  // The sheet's copy and the mic's own treatment key off this. In activity mode `speaking` IS
  // the level, and it is reported upward on the same channel the analyser uses so the caller
  // never has to know which pipeline is running.
  useEffect(() => {
    if (useAnalyser) return;
    onLevelRef.current?.(!!(active && speaking));
  }, [active, speaking, useAnalyser]);

  return (
    <div
      data-testid="waveform"
      data-active={active ? 'true' : undefined}
      data-source={useAnalyser ? 'analyser' : 'activity'}
      aria-hidden="true"
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
