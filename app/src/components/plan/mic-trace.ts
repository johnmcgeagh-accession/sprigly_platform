'use client';

/**
 * mic-trace.ts — an on-screen event log for the microphone, because the phone is the only
 * place the bug exists.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────
 *
 * The capture intermittency has now survived one fix. That fix was reasoned from the code and
 * it was not wrong about what it changed — it was incomplete about what else was running, and
 * a second reasoned-from-the-code patch would be the same bet placed twice. What is missing is
 * not analysis. It is a device.
 *
 * Nothing in this repo can produce the evidence: jsdom has no audio session, the simulator does
 * not arbitrate one the way the phone does, and desktop Safari lets two captures coexist that
 * iOS Safari does not. So the operator's phone has to report, and this is what it reports with.
 *
 * ── How the operator turns it on ─────────────────────────────────────────────────────
 *
 * Open the plan link with `?mic=trace` on the end. It is remembered in `sessionStorage` for the
 * rest of that tab, so the magic-link redirect cannot drop it, and it is gone when the tab
 * closes. `?mic=off` clears it.
 *
 * ── What it records, and why each line matters ───────────────────────────────────────
 *
 * Every acquisition, every lifecycle event, and every teardown, in order, with a monotonic
 * millisecond offset. The three questions the log has to answer:
 *
 *   1. HOW MANY captures are open at once? Each `gum:*` and `rec:*` line names its owner, so
 *      two owners live at the same time is visible as two un-closed opens.
 *   2. WHEN does recognition actually die? `rec:end` or `rec:error` arriving seconds before the
 *      client stops talking is the whole bug, and its timestamp says what preceded it.
 *   3. DOES the meter's stream survive? `gum:frames` reports whether the analyser is reading
 *      non-zero data. A flatline with the stream still "open" is a stream that was interrupted
 *      rather than closed — which is what an audio-session fight looks like from inside the page.
 *
 * It is a ring buffer of RING entries, appended to from hot paths (including a rAF loop, which
 * is why `frames` is sampled rather than logged per tick) and read by a component that renders
 * it. No network, no storage beyond the flag.
 */

export interface MicTraceEntry {
  /** Milliseconds since the trace was armed. Monotonic; `performance.now`-based. */
  t: number;
  /** `owner:event`, e.g. `rec:start`, `gum:open(meter)`. Kept short — it is read on a phone. */
  ev: string;
  /** Anything worth carrying. Kept to one short clause for the same reason. */
  detail?: string | undefined;
}

const RING = 120;
const FLAG_KEY = 'sprigly:mic-trace';

let entries: MicTraceEntry[] = [];
let t0 = 0;
let listeners: (() => void)[] = [];

/** Is the trace armed for this tab? Reads the URL once, then the sessionStorage it wrote. */
export function micTraceEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('mic');
    if (q === 'trace') window.sessionStorage.setItem(FLAG_KEY, '1');
    if (q === 'off') window.sessionStorage.removeItem(FLAG_KEY);
    return window.sessionStorage.getItem(FLAG_KEY) === '1';
  } catch {
    // Private mode with storage disabled: the URL alone still arms it for this page load.
    try { return new URLSearchParams(window.location.search).get('mic') === 'trace'; } catch { return false; }
  }
}

/**
 * Record an event. A no-op when the trace is off, so call sites need no guard of their own —
 * an instrument you have to remember to disable is an instrument that ships enabled.
 */
export function micTrace(ev: string, detail?: string): void {
  if (!micTraceEnabled()) return;
  if (!t0) t0 = performance.now();
  entries = [...entries.slice(-(RING - 1)), { t: Math.round(performance.now() - t0), ev, ...(detail ? { detail } : {}) }];
  for (const l of listeners) l();
}

export function micTraceEntries(): MicTraceEntry[] { return entries; }

export function micTraceClear(): void {
  entries = []; t0 = 0;
  for (const l of listeners) l();
}

/** Subscribe to appends. Returns the unsubscribe. */
export function onMicTrace(fn: () => void): () => void {
  listeners = [...listeners, fn];
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

/** The log as text, for the operator to copy out of the page and paste into the report. */
export function micTraceText(): string {
  return entries.map((e) => `${String(e.t).padStart(6)}ms  ${e.ev}${e.detail ? `  ${e.detail}` : ''}`).join('\n');
}
