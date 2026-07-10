/**
 * plan.ts — server-side plan reads. Loads content_cycle_posts for a cycle and maps
 * them to the PlanPost contract. All access is scoped by the caller's session
 * (clientId + cycleId), never by client-supplied ids.
 *
 * Slice 1 of the month switcher adds two read-only helpers alongside loadPlanPosts:
 *   loadCycleList        — the client's qualifying months (for the header menu).
 *   isCycleReadableByClient — the guard the read path uses before serving a
 *                          non-home cycle, so a forged ?cycleId= can never leak
 *                          another client's plan.
 * Neither widens WRITE scope: mutations stay bound to the session's own cycleId.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, contentCycles, contentCyclePosts } from '@sprigly/db';
import { listStepsForPosts } from '@/lib/steps';
import type {
  CycleSummary, PlanPost, PostChannel, PostFormat, PostStatus, ReviewState,
} from './types.js';

const FORMATS  = new Set<PostFormat>(['reel', 'carousel', 'single', 'email']);
const STATUSES = new Set<PostStatus>(['planned', 'edited', 'new', 'generating', 'generation_failed']);
const REVIEW_STATES = new Set<ReviewState>(['preserved_edit', 'preserved_edit_orphan', 'regenerated']);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'YYYY-MM' or 'YYYY-MM-DD' → 'July 2026'. Falls back to the raw string if it
 *  doesn't parse (defensive; every real cycle has dated posts). */
function monthLabel(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(yyyymm);
  if (!m) return yyyymm;
  const year = m[1];
  const idx  = Number(m[2]) - 1;
  return `${MONTH_NAMES[idx] ?? yyyymm} ${year}`;
}

/** cycle_month → the month it PLANS ('YYYY-MM' of cycle_month + 1). A cycle's plan
 *  month is always the month AFTER its cycle_month, so a post-less cycle (no post
 *  dates to derive from) is labelled by the month it is FOR, not its cycle_month —
 *  otherwise an empty cycle collides in month-space with the real cycle whose posts
 *  land in that same plan month. Returns 'YYYY-MM'. */
function nextMonth(cycleMonth: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(cycleMonth);
  if (!m) return cycleMonth.slice(0, 7);
  let year  = Number(m[1]);
  let month = Number(m[2]) + 1;
  if (month > 12) { month = 1; year += 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Load the plan posts for a cycle, ordered by position then date. Scoped to the
 *  session's client+cycle — pass both so a token can only ever read its own plan. */
export async function loadPlanPosts(clientId: string, cycleId: string): Promise<PlanPost[]> {
  const rows = await db
    .select()
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      isNull(contentCyclePosts.deletedAt),                 // exclude soft-deleted
    ))
    .orderBy(asc(contentCyclePosts.position), asc(contentCyclePosts.scheduledDate));

  // Batch the checklist for every post in ONE query (no N+1), then fold it in.
  const stepsByPost = await listStepsForPosts(rows.map((r) => r.id));

  return rows.map((r) => ({
    id:          r.id,
    cycleId:     r.cycleId,
    clientId:    r.clientId,
    channel:     (r.channel === 'email' ? 'email' : 'instagram') as PostChannel,
    date:        r.scheduledDate,                                   // already 'YYYY-MM-DD'
    format:      (FORMATS.has(r.format as PostFormat) ? r.format : 'single') as PostFormat,
    pillar:      r.pillar ?? '',
    caption:     r.caption ?? '',
    status:      (STATUSES.has(r.status as PostStatus) ? r.status : 'planned') as PostStatus,
    reviewState: (r.reviewState && REVIEW_STATES.has(r.reviewState as ReviewState) ? r.reviewState : null) as ReviewState | null,
    steps:       stepsByPost.get(r.id) ?? [],
    hook:        r.hook ?? null,
    script:      r.script ?? null,
    scriptLengthSeconds: r.scriptLengthSeconds ?? null,
    overlay:     r.overlay ?? null,
    pendingInstruction: metaStr(r.sourceMeta, 'pendingInstruction'),
    generationError:    metaStr(r.sourceMeta, 'generationError'),
  }));
}

/** Read a string field off a post's source_meta jsonb (null if absent/non-string). */
function metaStr(sourceMeta: unknown, key: string): string | null {
  if (!sourceMeta || typeof sourceMeta !== 'object') return null;
  const v = (sourceMeta as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * The client's qualifying cycles for a channel, newest month first — the source
 * for the header month menu. A cycle QUALIFIES if it has ≥1 live post AND its
 * posts_sync_status is not 'out_of_sync' ('synced' with or without provenance,
 * 'unknown', and NULL legacy all pass). The home cycle is ALWAYS included even if
 * it no longer qualifies, so the surface the token was minted for can never vanish
 * from its own switcher. Read-only; never widens write scope.
 */
export async function loadCycleList(
  clientId: string,
  channel:  string,
  homeCycleId: string,
): Promise<CycleSummary[]> {
  // Aggregate live posts per cycle. leftJoin so a cycle with zero live posts still
  // returns a row (liveCount 0); count(post.id) — not count(*) — so the phantom
  // null-join row doesn't inflate the count.
  const rows = await db
    .select({
      cycleId:    contentCycles.id,
      cycleMonth: contentCycles.cycleMonth,
      syncStatus: contentCycles.postsSyncStatus,
      syncedAt:   contentCycles.postsSyncedAt,
      updatedAt:  contentCycles.updatedAt,
      firstMonth: sql<string | null>`to_char(min(${contentCyclePosts.scheduledDate}), 'YYYY-MM')`,
      liveCount:  sql<number>`count(${contentCyclePosts.id})::int`,
      preservedEdit:       sql<number>`(count(${contentCyclePosts.id}) filter (where ${contentCyclePosts.reviewState} = 'preserved_edit'))::int`,
      preservedEditOrphan: sql<number>`(count(${contentCyclePosts.id}) filter (where ${contentCyclePosts.reviewState} = 'preserved_edit_orphan'))::int`,
    })
    .from(contentCycles)
    .leftJoin(contentCyclePosts, and(
      eq(contentCyclePosts.cycleId, contentCycles.id),
      isNull(contentCyclePosts.deletedAt),
    ))
    .where(and(
      eq(contentCycles.clientId, clientId),
      eq(contentCycles.channel, channel),
    ))
    .groupBy(
      contentCycles.id, contentCycles.cycleMonth, contentCycles.postsSyncStatus,
      contentCycles.postsSyncedAt, contentCycles.updatedAt,
    );

  // Qualify, then collapse any month collision to the most recent cycle.
  const byMonth = new Map<string, {
    summary: CycleSummary;
    syncedAt: Date | null;
    updatedAt: Date | null;
  }>();

  for (const r of rows) {
    const isHome     = r.cycleId === homeCycleId;
    const hasPosts   = r.liveCount > 0;
    const isBadState = r.syncStatus === 'out_of_sync';
    if (!isHome && (!hasPosts || isBadState)) continue;   // home is always kept

    // Plan month from the earliest live post date. If the cycle has no live posts,
    // there's no post date to derive from — fall back to the month it PLANS
    // (nextMonth(cycle_month)), NOT cycle_month, so an empty cycle doesn't mislabel
    // by one month and collide with the real cycle whose posts land in that month.
    const displayMonth = r.firstMonth ?? nextMonth(r.cycleMonth);
    const summary: CycleSummary = {
      cycleId:                  r.cycleId,
      displayMonth,
      monthLabel:               monthLabel(displayMonth),
      livePostCount:            r.liveCount,
      isHome,
      preservedEditCount:       r.preservedEdit,
      preservedEditOrphanCount: r.preservedEditOrphan,
    };

    const existing = byMonth.get(displayMonth);
    if (!existing) {
      byMonth.set(displayMonth, { summary, syncedAt: r.syncedAt, updatedAt: r.updatedAt });
      continue;
    }
    // Collision: one calendar month resolved to two cycles. A cycle WITH live posts
    // always beats an empty one — even an empty home cycle — so a not-yet-planned
    // home cycle can never shadow the real month's posts. Home-preference and
    // recency only break ties AMONG EQUALS (both populated, or both empty). The
    // unique index (client, channel, cycle_month) makes this defensive, not expected.
    const incomingHasPosts = summary.livePostCount > 0;
    const existingHasPosts = existing.summary.livePostCount > 0;
    let keepIncoming: boolean;
    if (incomingHasPosts !== existingHasPosts) {
      keepIncoming = incomingHasPosts;                 // the populated cycle wins outright
    } else {
      const incomingT = (r.syncedAt ?? r.updatedAt)?.getTime() ?? 0;
      const existingT = (existing.syncedAt ?? existing.updatedAt)?.getTime() ?? 0;
      keepIncoming = existing.summary.isHome ? false : (summary.isHome || incomingT >= existingT);
    }
    // eslint-disable-next-line no-console
    console.warn(`[loadCycleList] month ${displayMonth} has two cycles for client ${clientId}; keeping ${keepIncoming ? r.cycleId : existing.summary.cycleId}`);
    if (keepIncoming) byMonth.set(displayMonth, { summary, syncedAt: r.syncedAt, updatedAt: r.updatedAt });
  }

  return [...byMonth.values()]
    .map((v) => v.summary)
    .sort((a, b) => b.displayMonth.localeCompare(a.displayMonth));   // newest month first
}

/**
 * Guard for the read path: may THIS client read THIS cycle? True only if the cycle
 * belongs to the client AND qualifies (≥1 live post AND not 'out_of_sync'). The
 * caller allows the home cycle unconditionally; this covers every OTHER cycle, so a
 * forged ?cycleId= for another client (or an out_of_sync surface) is refused.
 */
export async function isCycleReadableByClient(clientId: string, cycleId: string): Promise<boolean> {
  const [row] = await db
    .select({
      syncStatus: contentCycles.postsSyncStatus,
      liveCount:  sql<number>`count(${contentCyclePosts.id})::int`,
    })
    .from(contentCycles)
    .leftJoin(contentCyclePosts, and(
      eq(contentCyclePosts.cycleId, contentCycles.id),
      isNull(contentCyclePosts.deletedAt),
    ))
    .where(and(
      eq(contentCycles.id, cycleId),
      eq(contentCycles.clientId, clientId),      // ownership — never trust the id alone
    ))
    .groupBy(contentCycles.id, contentCycles.postsSyncStatus);

  if (!row) return false;                        // not this client's cycle, or nonexistent
  if (row.syncStatus === 'out_of_sync') return false;
  return row.liveCount > 0;
}
