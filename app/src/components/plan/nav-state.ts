'use client';

/**
 * nav-state.ts — where the client is standing, persisted per tab.
 *
 * ── The time-jump this closes ────────────────────────────────────────────────────────
 *
 * Every in-page mutation of `selectedDay` is a gesture (audited in
 * docs/reports/agent-fixes.md, F2): the strip, the grid, the swipe, Today, the month arrows.
 * The re-anchor (`CommittedSurface`/`DraftSurface`, `anchoredMonth`) fires only when the MONTH
 * changes, and the month only changes through `switchCycle` — also a gesture. Refetches
 * (`refreshPlan`, an applied change, a poll settling) replace post arrays and never touch the
 * selection.
 *
 * What survives all of that is the FULL RELOAD nobody pressed: iOS Safari evicts a
 * backgrounded tab and reloads it on return, and pull-to-refresh does the same on purpose.
 * The URL carries no position, so `page.tsx` re-runs the today-based landing
 * (`resolveLandingCycleId`) and the surface re-anchors with `defaultDayFor` — and the operator
 * who was standing on the 13th is suddenly on today, or on the month's earliest post, having
 * touched nothing. Intermittent (only when Safari evicted), invisible to every in-page fix,
 * and exactly the shape of the report.
 *
 * So the position is written to `sessionStorage` on every change and read back on mount.
 * sessionStorage is the right scope: it survives reloads OF THIS TAB — including Safari's
 * eviction-reloads — and dies with the tab, so a fresh open of a magic link still lands by
 * the server's rule. A `?cycle=` in the URL (the approval redirect) is explicit intent and
 * outranks the restore; the restore outranks the landing heuristics, because "where they were
 * standing" is not a guess.
 */

export interface NavState {
  cycleId: string;
  /** ISO 'YYYY-MM-DD' — the selected day on that cycle's surface. */
  selected: string;
  view: string;
}

const KEY = 'sprigly:nav-state';

/**
 * THE POSITION THIS PAGE LOAD STARTED FROM, captured before anything overwrites it.
 *
 * React runs CHILD effects before PARENT effects. `CommittedSurface`'s save therefore fired
 * before `PlanRoot`'s restore ever read the key — the surface wrote the month the server had
 * just landed on over the month the tab had been standing on, and the restore then found them
 * equal and returned. The F2 restore never once ran (`september-jump.interaction.test.tsx`
 * records it).
 *
 * So the read is snapshotted at module load, which is the earliest moment this tab has: before
 * any component has mounted, let alone saved. `readNavState` serves that snapshot; the live key
 * is only ever written.
 */
let snapshot: NavState | null | undefined;

export function saveNavState(state: NavState): void {
  if (typeof window === 'undefined') return;
  if (snapshot === undefined) snapshot = readStored();   // never let a save precede the capture
  try { window.sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

/** The key as it stands right now. Internal — every reader wants the snapshot. */
function readStored(): NavState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<NavState>;
    if (typeof v.cycleId !== 'string' || typeof v.selected !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.selected)) return null;
    return { cycleId: v.cycleId, selected: v.selected, view: typeof v.view === 'string' ? v.view : 'day' };
  } catch { return null; }
}

/** The position this page load INHERITED — never one written since it began. */
export function readNavState(): NavState | null {
  if (typeof window === 'undefined') return null;
  if (snapshot === undefined) snapshot = readStored();
  return snapshot;
}

/** TEST-ONLY: a jsdom module outlives many renders; each test is its own page load. */
export function resetNavSnapshot(): void { snapshot = undefined; }

/** The URL named a cycle explicitly (the approval redirect). Explicit intent outranks restore. */
export function urlNamesCycle(): boolean {
  if (typeof window === 'undefined') return false;
  try { return new URLSearchParams(window.location.search).has('cycle'); } catch { return false; }
}

/**
 * THE DAY reads the LIVE key, not the snapshot, and the two are different questions.
 *
 * The CYCLE restore asks "which month was this tab on before this page load began?" — a
 * question only the inherited value can answer, and the one the child's save was destroying.
 * The DAY asks "where was I standing on this exact cycle and month?", which is true of the
 * live value too, and has to be: the surface remounts within one page load (a month switched
 * away and back), and on those the snapshot is stale by design. It cannot drag the client
 * anywhere either way, because it is refused unless the cycle AND the month both match.
 *
 * The day the surface should restore for (cycleId, month), or null when the stored position
 * belongs somewhere else. A stored day is only honoured on ITS OWN cycle and month — a stale
 * position must never drag a different month to a random date.
 */
export function restoreDayFor(cycleId: string, month: string): string | null {
  const s = readStored();
  if (!s || s.cycleId !== cycleId || s.selected.slice(0, 7) !== month) return null;
  return s.selected;
}
