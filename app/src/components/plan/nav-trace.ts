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
 * ── ARMABLE ON THE DEVICE, ROUND 4 ───────────────────────────────────────────────────
 *
 * A query parameter is an instruction to retype a URL, and the operator reaches this surface
 * through a magic link on a phone — by the time they have found the address bar and got
 * `?nav=trace` into it, the session they wanted to watch is over, and the jump happens when it
 * happens rather than when the trace is on. So the flag is also reachable from the SURFACE:
 * three taps on the wordmark (`PlanShell.tsx`) toggle it, mid-session, with no reload, and the
 * panel appears immediately because arming notifies the same listeners an entry does.
 *
 * The URL form is unchanged and still wins on load; this is a second door to the same flag.
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
  /** The frame that called — `file:line`, with the function name when the engine gives one.
   *  The reason is what the call site claims; this is what it is. */
  from?: string | undefined;
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

/**
 * Arm or disarm the trace for this tab, from the surface rather than from the URL.
 *
 * Returns the state it landed in, so the caller can say so. Notifies the same listeners an
 * entry does — that is what makes the panel appear on the third tap instead of on the next
 * navigation, which on a surface whose bug IS a navigation would be a trap.
 */
export function navTraceArm(on: boolean): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (on) window.sessionStorage.setItem(FLAG_KEY, '1');
    else window.sessionStorage.removeItem(FLAG_KEY);
  } catch { /* a tab with no storage cannot hold the flag; the URL form still works */ }
  if (!on) { entries = []; t0 = 0; }   // disarming clears: a stale log is worse than none
  for (const l of listeners) l();
  return navTraceEnabled();
}

/** Flip it. The wordmark's triple tap calls this. */
export function navTraceToggle(): boolean {
  return navTraceArm(!navTraceEnabled());
}

/**
 * WHERE THE CALL CAME FROM.
 *
 * Round 2: the jump survived a fix aimed at it, and the log said `select …` without saying who
 * called. A reason string is what the call site CLAIMS; the stack frame is what it IS — and the
 * two disagreeing is exactly the shape of a mover nobody has found yet. So every entry carries
 * the first frame above `navTrace` itself: file, line, function.
 *
 * Built from an Error's stack, which every engine this ships to produces. Never throws — a
 * missing or unparseable stack costs a column, not an instrument.
 */
function callSite(): string | undefined {
  try {
    const lines = (new Error().stack ?? '').split('\n');
    // 0 = "Error", 1 = callSite, 2 = navTrace, 3 = the caller we want.
    const raw = lines[3];
    if (!raw) return undefined;
    const m = /at\s+(?:(\S+)\s+)?\(?(?:.*\/)?([^/\s)]+:\d+):\d+\)?/.exec(raw.trim());
    if (!m) return raw.trim().replace(/^at\s+/, '').slice(0, 60);
    const fn = m[1] && m[1] !== '<anonymous>' ? `${m[1]} ` : '';
    return `${fn}${m[2]}`;
  } catch { return undefined; }
}

/** Record an event. A no-op when the trace is off, so call sites need no guard of their own. */
export function navTrace(ev: string, detail?: string): void {
  if (!navTraceEnabled()) return;
  if (!t0) t0 = performance.now();
  const from = callSite();
  entries = [...entries.slice(-(RING - 1)), {
    t: Math.round(performance.now() - t0), ev,
    ...(detail ? { detail } : {}),
    ...(from ? { from } : {}),
  }];
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
  return entries
    .map((e) => `${String(e.t).padStart(6)}ms  ${e.ev}${e.detail ? `  ${e.detail}` : ''}${e.from ? `   ← ${e.from}` : ''}`)
    .join('\n');
}
