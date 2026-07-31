'use client';

/**
 * what-changed.ts — the seen-state and the words for the recently-changed marks.
 *
 * ── The design (operator ruling, round 4) ────────────────────────────────────────────
 *
 * ONE changed-surface: day dots gain a RECENTLY-CHANGED state — an accent second dot on days
 * holding posts changed since the client's last visit, decaying as each day is viewed. They
 * are computed from the existing plan_activity ledger, read through /api/plan/changes.
 *
 * The "What changed" row and its panel are GONE. They listed, in words, the same receipts the
 * dots were already marking on the calendar — a count in the header over a calendar that had
 * the answer, and a tap that replaced the plan with a list of the plan. `changeWord` went with
 * them: it existed to write that panel's lines and had no other reader.
 *
 * ── The seen-state ───────────────────────────────────────────────────────────────────
 *
 * "Since last visit" needs a last visit, and localStorage is its honest home: it is a fact
 * about THIS DEVICE's reader, it must survive tab-death (sessionStorage would re-mark
 * everything after every eviction, crying wolf daily), and it costs the server nothing. The
 * read-then-stamp shape matters: the PREVIOUS visit's stamp bounds this visit's marks, and the
 * stamp is advanced immediately so the next visit starts from now.
 *
 * Decay is per-day and in-memory: viewing a marked day unmarks it for this session. The next
 * visit recomputes from the stamp, which is later than every change just seen.
 */

export interface ChangeRow {
  id: string;
  action: string;
  postId: string | null;
  date: string | null;
  title: string | null;
  at: string;
  origin: string;
}

const SEEN_KEY = (cycleId: string) => `sprigly:seen:${cycleId}`;

/**
 * One "visit" per page load, per cycle. Read-then-stamp is not idempotent, and React's dev
 * StrictMode runs mount effects twice: the second run read the FIRST run's fresh stamp and
 * concluded nothing had changed — the marks vanished on exactly the visit they were for. The
 * memo pins the answer for the lifetime of the page's JS (module state dies with the page,
 * which is the definition of a visit); repeat calls — StrictMode, a cycle switched away and
 * back — get the same answer the visit started with.
 */
const visitPrev = new Map<string, string | null>();

/** Read the previous visit's stamp and advance it to now. Returns the PREVIOUS stamp;
 *  idempotent within one page load (see above). */
export function readAndStampVisit(cycleId: string, nowIso: string): string | null {
  if (typeof window === 'undefined') return null;
  if (visitPrev.has(cycleId)) return visitPrev.get(cycleId)!;
  try {
    const prev = window.localStorage.getItem(SEEN_KEY(cycleId));
    window.localStorage.setItem(SEEN_KEY(cycleId), nowIso);
    visitPrev.set(cycleId, prev);
    return prev;
  } catch { return null; }
}

/** TEST-ONLY: a jsdom module outlives many renders; each test is its own "page load". */
export function resetVisitStamps(): void { visitPrev.clear(); }

/** The days that should carry the recently-changed mark, minus what has been viewed. */
export function changedDays(changes: readonly ChangeRow[], seen: ReadonlySet<string>): Set<string> {
  const days = new Set<string>();
  for (const c of changes) if (c.date && !seen.has(c.date)) days.add(c.date);
  return days;
}
