'use client';

/**
 * nav-trace.ts — an on-screen event log for NAVIGATION, because the time-jump only happens on
 * the operator's phone.
 *
 * The same instrument shape as `mic-trace.ts`, for the same reason: the forward date-jump has
 * now survived one fix (the ghost-click swallow), which means the next report needs a log, not
 * another reasoned-from-the-code bet. Every mutation of the surface's position — the selected
 * day, the viewed cycle, the view — records WHO moved it and to where, so a jump that happens
 * with no finger on the screen names its own mechanism.
 *
 * Armed with `?nav=trace` on the plan link; remembered in `sessionStorage` for the tab so the
 * magic-link redirect cannot drop it; `?nav=off` clears it. Renders nothing unless armed
 * (`NavTracePanel.tsx`), so it is safe to leave in the build.
 *
 * The one event class that matters most is the one this exists for: a `select` line whose
 * reason is NOT `user:*`. Every legitimate selection change is a gesture or a restore; anything
 * else in that column is the bug, timestamped.
 */

export interface NavTraceEntry {
  /** Milliseconds since the trace was armed. Monotonic; `performance.now`-based. */
  t: number;
  /** `what:reason`, e.g. `select user:strip`, `cycle restore:session`. */
  ev: string;
  detail?: string | undefined;
}

const RING = 120;
const FLAG_KEY = 'sprigly:nav-trace';

let entries: NavTraceEntry[] = [];
let t0 = 0;
let listeners: (() => void)[] = [];

/** Is the trace armed for this tab? Reads the URL once, then the sessionStorage it wrote. */
export function navTraceEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('nav');
    if (q === 'trace') window.sessionStorage.setItem(FLAG_KEY, '1');
    if (q === 'off') window.sessionStorage.removeItem(FLAG_KEY);
    return window.sessionStorage.getItem(FLAG_KEY) === '1';
  } catch {
    try { return new URLSearchParams(window.location.search).get('nav') === 'trace'; } catch { return false; }
  }
}

/** Record an event. A no-op when the trace is off, so call sites need no guard of their own. */
export function navTrace(ev: string, detail?: string): void {
  if (!navTraceEnabled()) return;
  if (!t0) t0 = performance.now();
  entries = [...entries.slice(-(RING - 1)), { t: Math.round(performance.now() - t0), ev, ...(detail ? { detail } : {}) }];
  for (const l of listeners) l();
}

export function navTraceEntries(): NavTraceEntry[] { return entries; }

export function navTraceClear(): void {
  entries = []; t0 = 0;
  for (const l of listeners) l();
}

/** Subscribe to appends. Returns the unsubscribe. */
export function onNavTrace(fn: () => void): () => void {
  listeners = [...listeners, fn];
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

/** The log as text, for the operator to copy out of the page and paste into the report. */
export function navTraceText(): string {
  return entries.map((e) => `${String(e.t).padStart(6)}ms  ${e.ev}${e.detail ? `  ${e.detail}` : ''}`).join('\n');
}
