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

export function saveNavState(state: NavState): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export function readNavState(): NavState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<NavState>;
    if (typeof v.cycleId !== 'string' || typeof v.selected !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.selected)) return null;
    return { cycleId: v.cycleId, selected: v.selected, view: typeof v.view === 'string' ? v.view : 'day' };
  } catch { return null; }
}

/** The URL named a cycle explicitly (the approval redirect). Explicit intent outranks restore. */
export function urlNamesCycle(): boolean {
  if (typeof window === 'undefined') return false;
  try { return new URLSearchParams(window.location.search).has('cycle'); } catch { return false; }
}

/**
 * The day the surface should restore for (cycleId, month), or null when the stored position
 * belongs somewhere else. A stored day is only honoured on ITS OWN cycle and month — a stale
 * position must never drag a different month to a random date.
 */
export function restoreDayFor(cycleId: string, month: string): string | null {
  const s = readNavState();
  if (!s || s.cycleId !== cycleId || s.selected.slice(0, 7) !== month) return null;
  return s.selected;
}
