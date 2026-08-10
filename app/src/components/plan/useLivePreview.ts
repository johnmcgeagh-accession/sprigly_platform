'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BriefPreview } from '@sprigly/engine';   // type-only — erased, no runtime engine pull

/** Idle debounce before a live preview call (Part 2: 2–3s). */
const DEBOUNCE_MS = 2500;
/** Min characters before we bother the model (mirrors the server short-circuit). */
const MIN_CHARS = 12;
/** Hard per-session cap on live calls (the cost guard; server also token-buckets). */
const SESSION_CAP = 20;

/**
 * Debounced live-preview driver. Cost guard: never calls while one is in flight, and stops after
 * SESSION_CAP calls per mounted session. The preview NEVER writes the DB. `schedule(text)` is
 * called on each keystroke; the call fires only after the input has been idle for DEBOUNCE_MS.
 */
export function useLivePreview(cycleId?: string) {
  const [preview, setPreview] = useState<BriefPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [calls, setCalls] = useState(0);
  const inFlight = useRef(false);
  const callsRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef('');

  const run = useCallback(async () => {
    const text = latest.current;
    if (inFlight.current || callsRef.current >= SESSION_CAP) return;
    if (text.trim().length < MIN_CHARS) { setPreview(null); return; }
    inFlight.current = true; setLoading(true);
    callsRef.current += 1; setCalls(callsRef.current);
    try {
      // The cycle, not the month: the SERVER derives which month this brief is for, so the
      // preview's instructions and the panel's heading cannot come to say different things.
      const res = await fetch('/api/plan/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, ...(cycleId ? { cycleId } : {}) }),
      });
      if (res.ok) { const d = (await res.json()) as { preview?: BriefPreview }; if (d.preview) setPreview(d.preview); }
    } catch { /* preview is best-effort — keep the last good one */ }
    finally { inFlight.current = false; setLoading(false); }
  }, [cycleId]);

  const schedule = useCallback((text: string) => {
    latest.current = text;
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < MIN_CHARS) { setPreview(null); return; }
    timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
  }, [run]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { preview, loading, schedule, calls, capped: calls >= SESSION_CAP };
}
