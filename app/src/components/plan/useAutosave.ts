'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Save lifecycle for the inline hint: nothing shown until the first save, then in-flight,
 *  then settled. Stays 'saved' until the next edit dirties the field again. */
export type SaveStatus = 'idle' | 'saving' | 'saved';

/**
 * Debounced + on-blur autosave for a text field. One PATCH (→ one ledger row) per
 * *settled* edit, never per keystroke: a save fires `delay` ms after the last change,
 * or immediately on blur/unmount. `persisted` is the server truth — when it changes
 * from outside (a candidate pick, a shape job, a reload, switching record) it becomes
 * the new baseline and is never echoed back. `markSaved` lets a caller record a value
 * it already persisted so the debounce doesn't double-save it.
 *
 * Shared by the caption/hook/script fields (PostEditor) and the editable checklist
 * step labels (ChecklistItem).
 */
export function useAutosave(value: string, persisted: string, save: (v: string) => void | Promise<void>, enabled: boolean, delay = 1500) {
  const savedRef = useRef(persisted);
  const valueRef = useRef(value);
  const saveRef = useRef(save);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [status, setStatus] = useState<SaveStatus>('idle');
  valueRef.current = value;
  saveRef.current = save;

  // External change to the persisted value → new baseline (don't autosave it back).
  useEffect(() => { savedRef.current = persisted; }, [persisted]);
  // Re-arm on (re)mount, not just tear down: under StrictMode the mount/unmount/remount
  // cycle would otherwise leave `mounted` stuck false and swallow every status update.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const v = valueRef.current;
    if (!enabled || v === savedRef.current) return;
    savedRef.current = v;
    if (mounted.current) setStatus('saving');
    // Reflect the real save: 'saved' once it settles, back to 'idle' if it errored. The save
    // itself surfaces its own failure toast (via call()); this only drives the inline hint.
    Promise.resolve(saveRef.current(v))
      .then(() => { if (mounted.current) setStatus('saved'); })
      .catch(() => { if (mounted.current) setStatus('idle'); });
  }, [enabled]);

  // Debounce a save `delay` after the last change.
  useEffect(() => {
    if (!enabled || value === savedRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; flush(); }, delay);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [value, enabled, delay, flush]);

  // Flush a pending edit on unmount (e.g. drawer closed via Escape before a blur).
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => () => { flushRef.current(); }, []);

  const markSaved = useCallback((v: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    savedRef.current = v;
  }, []);

  // Whether the local value has diverged from the last-synced baseline (an unsaved edit).
  // Computed in render on purpose: it reads `savedRef` BEFORE the persisted-sync effect
  // (line 25) advances the baseline this render, so a caller that reads it during the same
  // render an external value arrives sees "was this field dirty when the new value landed?"
  // — the question its reset guard must answer. The baseline is the hook's own truth, so no
  // caller re-derives it.
  const dirty = value !== savedRef.current;

  return { flush, markSaved, dirty, status };
}
