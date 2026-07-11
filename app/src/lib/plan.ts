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
import { and, asc, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import type { ContentCyclePostRow } from '@sprigly/db';
import { db, contentCycles, contentCyclePosts } from '@sprigly/db';
import { listStepsForPosts } from '@/lib/steps';
import { nextMonth } from '@/lib/cycle-nav';
import type {
  CycleSummary, PlanPost, PostChannel, PostFormat, PostStatus, ReviewState, PostStepView,
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

/** Map a content_cycle_posts row (+ its batched steps) to the PlanPost contract.
 *  Every post carries its OWN cycleId, so a post surfaced in another cycle's month view
 *  still routes edits to its real cycle (edit gates are date+client based, not cycle based). */
function toPlanPost(r: ContentCyclePostRow, stepsByPost: Map<string, PostStepView[]>): PlanPost {
  return {
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
  };
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
  return rows.map((r) => toPlanPost(r, stepsByPost));
}

/**
 * The calendar grid is DATE-authoritative across cycles: the month view for M shows every
 * live post of the client (ANY cycle, same channel) whose scheduled_date falls in M. This
 * returns the OTHER cycles' posts dated in M — the viewed cycle's own posts already load
 * via loadPlanPosts, so excluding it here keeps every post in exactly ONE set (no dupes).
 * A cross-month-moved post therefore appears in the month view its date lands in, on its
 * date. Client-scoped read; edit routing is unchanged (each post keeps its own cycleId).
 */
export async function loadCrossMonthPosts(
  clientId: string, channel: string, month: string, excludeCycleId: string,
): Promise<PlanPost[]> {
  const start = `${month}-01`;
  const end   = `${nextMonth(month)}-01`;   // exclusive upper bound
  const rows = await db
    .select()
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.channel, channel),
      ne(contentCyclePosts.cycleId, excludeCycleId),
      isNull(contentCyclePosts.deletedAt),
      gte(contentCyclePosts.scheduledDate, start),
      lt(contentCyclePosts.scheduledDate, end),
    ))
    .orderBy(asc(contentCyclePosts.scheduledDate));

  const stepsByPost = await listStepsForPosts(rows.map((r) => r.id));
  return rows.map((r) => toPlanPost(r, stepsByPost));
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
    .groupBy(contentCycles.id, contentCycles.cycleMonth, contentCycles.postsSyncStatus);

  // A cycle's month is ALWAYS the month it PLANS — nextMonth(cycle_month) — for populated
  // and empty cycles alike; it is NEVER derived from post dates. cycle_month is unique per
  // (client, channel) via the unique index, so displayMonth is unique per cycle: distinct
  // cycles can never collide in month-space, and a cross-month-moved post can no longer
  // relabel its cycle or shadow another (the old min(scheduled_date)-derived label + the
  // collision-tiebreak that resolved it are gone — deliberately no residual collision path).
  const out: CycleSummary[] = [];
  for (const r of rows) {
    const isHome = r.cycleId === homeCycleId;
    if (!isHome && (r.liveCount === 0 || r.syncStatus === 'out_of_sync')) continue;   // home is always kept
    const displayMonth = nextMonth(r.cycleMonth);
    out.push({
      cycleId:                  r.cycleId,
      displayMonth,
      monthLabel:               monthLabel(displayMonth),
      livePostCount:            r.liveCount,
      isHome,
      preservedEditCount:       r.preservedEdit,
      preservedEditOrphanCount: r.preservedEditOrphan,
    });
  }
  return out.sort((a, b) => b.displayMonth.localeCompare(a.displayMonth));   // newest month first
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
