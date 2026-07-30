'use client';

/**
 * what-changed.ts — the seen-state and the words for the recently-changed marks.
 *
 * ── The design (operator-agreed) ─────────────────────────────────────────────────────
 *
 * a) Day dots gain a RECENTLY-CHANGED state: an accent second dot on days holding posts
 *    changed since the client's last visit, decaying as each day is viewed.
 * b) A "What changed" row from the month header lists the recent receipts (the existing
 *    plan_activity ledger, read through /api/plan/changes), tapping through to the day.
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

/** Read the previous visit's stamp and advance it to now. Returns the PREVIOUS stamp. */
export function readAndStampVisit(cycleId: string, nowIso: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const prev = window.localStorage.getItem(SEEN_KEY(cycleId));
    window.localStorage.setItem(SEEN_KEY(cycleId), nowIso);
    return prev;
  } catch { return null; }
}

/** The words a receipt row carries. Computed from the ledger action — never model prose. */
export function changeWord(action: string): string {
  switch (action) {
    case 'post_created':  return 'Added';
    case 'rescheduled':   return 'Moved';
    case 'caption_saved': return 'Caption updated';
    case 'hook_saved':    return 'Hook updated';
    case 'script_saved':  return 'Script updated';
    case 'format_changed': return 'Format changed';
    case 'post_deleted':  return 'Removed';
    case 'post_reverted': return 'Reverted';
    default: return 'Updated';
  }
}

/** The days that should carry the recently-changed mark, minus what has been viewed. */
export function changedDays(changes: readonly ChangeRow[], seen: ReadonlySet<string>): Set<string> {
  const days = new Set<string>();
  for (const c of changes) if (c.date && !seen.has(c.date)) days.add(c.date);
  return days;
}
