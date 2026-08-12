/**
 * brief-summary.ts — a persisted structured_brief, said back to the client in their own terms.
 *
 * ONE definition, deliberately, because two callers need the same sentences and they run at
 * different times:
 *
 *   - POST /api/plan/intake, at the moment of saving, for the "here's what we took" panel that
 *     appears under the composer the instant a brief lands.
 *   - The plan surfaces (page.tsx SSR + GET /api/plan), on every later load, so that the SAME
 *     panel is still there when the client comes back tomorrow.
 *
 * If those two drifted, a brief would be described one way when saved and another way when
 * re-opened, which is worse than not describing it at all — it reads as the plan having
 * silently changed.
 *
 * NOTHING HERE CALLS A MODEL. `structured_brief` is already extracted and persisted by the save
 * path (intake/route.ts extractAndPersistBrief); this is a pure projection of that stored row.
 * Re-running extraction on a page load would be a Sonnet call per reload, for a brief that has
 * not changed since the last one.
 *
 * Pure. No React, no db, no fetch.
 */
import type { StructuredBrief } from '@sprigly/engine';
import type { ExtractedSummary } from '@/lib/types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → '25 Aug' (defensive: returns the raw string if it doesn't parse). */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1] ?? m[2]}` : iso;
}

/** Compact, human-readable summary of an extracted brief for the "here's what we took" moment. */
export function summariseBrief(brief: StructuredBrief): ExtractedSummary {
  const launches = brief.products.map((p) => {
    const name = `${p.product}${p.colourway ? ` in ${p.colourway}` : ''}`;
    return p.status === 'restock' ? `${name} — restock` : `${name} — new`;
  });
  const dates = brief.schedule.map((b) => ({
    when: b.dateRange ? `${shortDate(b.dateRange.start)}–${shortDate(b.dateRange.end)}` : shortDate(b.date ?? ''),
    label: (b.product || b.type || 'beat').replace(/-/g, ' '),
  }));
  const asks = brief.content_asks.map((a) => (a.product ? `${a.type.replace(/-/g, ' ')} (${a.product})` : a.type.replace(/-/g, ' ')));
  return { launches, dates, asks };
}

/**
 * The same projection, over a column that may hold anything or nothing.
 *
 * `structured_brief` is nullable by design and is CLEARED on every intake change
 * (clearStructuredBriefIfPrePlanning) before the fresh extraction re-persists it — so a reader
 * can legitimately arrive between those two writes and find null. It is also `jsonb`, which
 * types as `unknown` at the boundary and has held older shapes across migrations.
 *
 * Returning null rather than throwing is the point: this drives a decorative panel. A brief that
 * cannot be summarised must cost the client their empty state, not their page.
 */
export function summariseSavedBrief(raw: unknown): ExtractedSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<StructuredBrief>;
  if (!Array.isArray(b.products) || !Array.isArray(b.schedule) || !Array.isArray(b.content_asks)) return null;
  try {
    const s = summariseBrief(b as StructuredBrief);
    // An extraction that found nothing is not worth a panel — the empty state says more.
    return s.launches.length || s.dates.length || s.asks.length ? s : null;
  } catch { return null; }
}
