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
import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { ContentCyclePostRow } from '@sprigly/db';
import { db, contentCycles, contentCyclePosts, clientPlanningConfig, excludeDraftPosts, POST_STATUS_DRAFT, PRE_PLANNING_STATUSES } from '@sprigly/db';
import type { BeatMeta } from '@sprigly/db';
import { listStepsForPosts } from '@/lib/steps';
import { normalisePostingTime } from '@/lib/posting-time';
import { nextMonth } from '@/lib/cycle-nav';
import { resolveSurfaceKind, mayHaveDraftSurface, type SurfaceKind } from '@/lib/surface-state';
import { cycleIsPreCutoff } from '@/lib/draft-mutations';
import { loadReceipts, type DraftApplication } from '@/lib/draft-apply';
import type {
  CycleSummary, PlanPost, PlanBeat, PostChannel, PostFormat, PostStatus, ReviewState, PostStepView,
  DraftBeatView, BeatEvidence,
} from './types.js';
export type { PlanBeat } from './types.js';

/** The last ISO day ('YYYY-MM-DD') of a 'YYYY-MM' month. */
function monthEndIso(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const dom = new Date(Date.UTC(y, m, 0)).getUTCDate();   // Date.UTC(y, m, 0) = last day of 1-based month m
  return `${month}-${String(dom).padStart(2, '0')}`;
}

/** Beats from a (possibly null) structured_brief whose dates fall in `month` ('YYYY-MM').
 *  Handles BOTH single-day beats ({ date }) and range beats ({ dateRange: { start, end } }).
 *  A range beat renders ONCE (no continuation bands): it is placed on the FIRST day of its
 *  span visible in the viewed month (== range.start, or the month's first day when the span
 *  began earlier), and carries its FULL, unclipped span for the label suffix + tap. Pure +
 *  defensive: a null/malformed brief or beat is skipped. Viewed-cycle-only — cross-cycle
 *  brief beats are not merged (Build 3). */
export function beatsInMonth(brief: unknown, month: string): PlanBeat[] {
  const schedule = (brief as { schedule?: unknown } | null)?.schedule;
  if (!Array.isArray(schedule)) return [];
  const monthStart = `${month}-01`;
  const monthEnd   = monthEndIso(month);
  const out: PlanBeat[] = [];
  for (const b of schedule) {
    if (!b || typeof b !== 'object') continue;
    const r = b as Record<string, unknown>;
    const base = {
      type:      String(r.type ?? ''),
      product:   typeof r.product === 'string' ? r.product : null,
      colourway: typeof r.colourway === 'string' ? r.colourway : null,
      note:      String(r.note ?? ''),
    };
    const dr = r.dateRange;
    if (dr && typeof dr === 'object'
        && typeof (dr as Record<string, unknown>).start === 'string'
        && typeof (dr as Record<string, unknown>).end === 'string') {
      // Range beat: keep only if the FULL span overlaps the viewed month; place it on the
      // first visible day (clamped up to the month's first day when it started earlier), but
      // keep the full span for display so a prior-month start still reads the true window.
      const start = String((dr as Record<string, unknown>).start);
      const end   = String((dr as Record<string, unknown>).end);
      if (start > monthEnd || end < monthStart) continue;             // no overlap with this month
      const placement = start > monthStart ? start : monthStart;      // first day visible this month
      out.push({ date: placement, range: { start, end }, ...base });
    } else if (typeof r.date === 'string' && r.date.startsWith(month)) {
      // Single-day beat (incl. persisted pre-range beats that carry `date` only).
      out.push({ date: r.date, range: null, ...base });
    }
  }
  return out;
}

const FORMATS  = new Set<PostFormat>(['reel', 'carousel', 'single', 'email']);
const STATUSES = new Set<PostStatus>(['planned', 'edited', 'new', 'generating', 'generation_failed', 'draft']);
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
    // Gap 1 (read): the planning path writes this; until now nothing read it back.
    postingTime:        normalisePostingTime(metaStr(r.sourceMeta, 'postingTime')),
    title:              metaStr(r.sourceMeta, 'title'),
    rationale:          metaStr(r.sourceMeta, 'competitorInsight'),
  };
}

/** Load the plan posts for a cycle, ordered by position then date. Scoped to the
 *  session's client+cycle — pass both so a token can only ever read its own plan.
 *
 *  This is the load behind THREE surfaces — first paint (page.tsx), GET /api/plan,
 *  and the agent's plan context (lib/agent/turn.ts) — so the draft fence here is
 *  also what stops the agent counting unapproved beats as the plan. */
export async function loadPlanPosts(clientId: string, cycleId: string): Promise<PlanPost[]> {
  const rows = await db
    .select()
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      isNull(contentCyclePosts.deletedAt),                 // exclude soft-deleted
      excludeDraftPosts(),                                 // unapproved draft beats are NOT the plan
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
      excludeDraftPosts(),                                 // draft beats never reach the calendar grid
      gte(contentCyclePosts.scheduledDate, start),
      lt(contentCyclePosts.scheduledDate, end),
    ))
    .orderBy(asc(contentCyclePosts.scheduledDate));

  const stepsByPost = await listStepsForPosts(rows.map((r) => r.id));
  return rows.map((r) => toPlanPost(r, stepsByPost));
}

export { normalisePostingTime, isClockTime } from '@/lib/posting-time';

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
      status:     contentCycles.status,
      syncStatus: contentCycles.postsSyncStatus,
      liveCount:  sql<number>`count(${contentCyclePosts.id})::int`,
      preservedEdit:       sql<number>`(count(${contentCyclePosts.id}) filter (where ${contentCyclePosts.reviewState} = 'preserved_edit'))::int`,
      preservedEditOrphan: sql<number>`(count(${contentCyclePosts.id}) filter (where ${contentCyclePosts.reviewState} = 'preserved_edit_orphan'))::int`,
    })
    .from(contentCycles)
    .leftJoin(contentCyclePosts, and(
      eq(contentCyclePosts.cycleId, contentCycles.id),
      isNull(contentCyclePosts.deletedAt),
      // A cycle holding ONLY draft beats has no plan yet and must not qualify for the
      // month menu on their strength. Filtered in the JOIN, not the WHERE, so such a
      // cycle still returns its row with liveCount 0 rather than vanishing.
      excludeDraftPosts(),
    ))
    .where(and(
      eq(contentCycles.clientId, clientId),
      eq(contentCycles.channel, channel),
    ))
    .groupBy(contentCycles.id, contentCycles.cycleMonth, contentCycles.status, contentCycles.postsSyncStatus);

  // A cycle's month is ALWAYS the month it PLANS — nextMonth(cycle_month) — for populated
  // and empty cycles alike; it is NEVER derived from post dates. cycle_month is unique per
  // (client, channel) via the unique index, so displayMonth is unique per cycle: distinct
  // cycles can never collide in month-space, and a cross-month-moved post can no longer
  // relabel its cycle or shadow another (the old min(scheduled_date)-derived label + the
  // collision-tiebreak that resolved it are gone — deliberately no residual collision path).
  // A cycle holding only DRAFT beats scores liveCount 0 (the join fences drafts out), so
  // before this it qualified only by being the token's home cycle — a draft on any other
  // cycle was unreachable rather than merely mis-rendered
  // (docs/reports/draft-mode-not-rendering.md, anomaly 2). Named predicate, one query.
  const withDraft = await cyclesWithReviewableDraft(clientId, rows.map((r) => r.cycleId));

  const out: CycleSummary[] = [];
  for (const r of rows) {
    const isHome = r.cycleId === homeCycleId;
    const reviewableDraft = withDraft.has(r.cycleId);
    // Home is always kept; a reviewable draft is its own reason to be reachable; otherwise
    // the cycle must actually hold live, in-sync plan rows.
    if (!isHome && !reviewableDraft && (r.liveCount === 0 || r.syncStatus === 'out_of_sync')) continue;
    const displayMonth = nextMonth(r.cycleMonth);
    out.push({
      cycleId:                  r.cycleId,
      displayMonth,
      monthLabel:               monthLabel(displayMonth),
      livePostCount:            r.liveCount,
      isHome,
      prePlanning:              PRE_PLANNING_STATUSES.has(r.status),   // pre-cutoff → intake still open
      preservedEditCount:       r.preservedEdit,
      preservedEditOrphanCount: r.preservedEditOrphan,
    });
  }
  return out.sort((a, b) => b.displayMonth.localeCompare(a.displayMonth));   // newest month first
}

/**
 * Load a cycle's DRAFT beats. (Build B)
 *
 * The ONLY reader in the codebase permitted to see draft rows. Every other reader is
 * fenced by excludeDraftPosts(); this one inverts the filter deliberately and says so in
 * its name, so "who can see drafts?" has a single, greppable answer.
 *
 * Returns [] for a cycle with no drafts — a cycle whose posts are committed is simply not
 * in draft mode, which is not an error.
 */
export async function loadDraftBeats(clientId: string, cycleId: string): Promise<DraftBeatView[]> {
  const rows = await db
    .select()
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),     // ownership — never trust the id alone
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ))
    .orderBy(asc(contentCyclePosts.scheduledDate), asc(contentCyclePosts.position));

  return rows.map(toDraftBeat);
}

/** Map a draft row to the view contract. Defensive about beat_meta: a row written before
 *  the column existed, or by hand, must render as an honest unexplained beat rather than
 *  throwing or inventing a rationale. */
function toDraftBeat(r: ContentCyclePostRow): DraftBeatView {
  const meta = (r.beatMeta ?? {}) as Partial<BeatMeta>;
  const evidence = (meta.rationaleEvidence ?? { basis: 'template' }) as BeatEvidence;
  const sm = (r.sourceMeta ?? {}) as Record<string, unknown>;
  const title = typeof sm['title'] === 'string' && sm['title'].trim() ? sm['title'] : (r.pillar ?? 'Untitled beat');

  return {
    id:       r.id,
    cycleId:  r.cycleId,
    date:     r.scheduledDate,
    format:   (FORMATS.has(r.format as PostFormat) ? r.format : 'single') as PostFormat,
    pillar:   r.pillar ?? '',
    title,
    position: r.position,
    slotType: meta.slotType === 'experiment' ? 'experiment' : 'proven',
    evidence,
    assumptions: Array.isArray(meta.assumptions) ? meta.assumptions.filter((a): a is string => typeof a === 'string') : [],
  };
}

/**
 * Does this cycle hold a draft the client can review? (Build B)
 *
 * The ONE deliberate exception to the draft fence, and deliberately its own named
 * predicate rather than a relaxation of `excludeDraftPosts()`. The fence stays exactly
 * as strict as Build A left it; readability becomes an explicit OR of two named
 * conditions instead. That way "the client may see this cycle" is a decision someone
 * wrote down, not a filter someone loosened.
 *
 * Reviewable means simply: at least one live draft beat. Deliberately NOT gated on the
 * pre-cutoff window — VIEWING a draft and EDITING one are different rights. A client
 * who opens their link the day after cutoff should still see what was drafted for them;
 * the mutations are what refuse (see requireDraftMutable in draft-mutations.ts).
 */
export async function cycleHasReviewableDraft(clientId: string, cycleId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contentCyclePosts.id })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),          // ownership — never trust the id alone
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  return !!row;
}

/**
 * The BATCH form of cycleHasReviewableDraft, for the month menu — which asks the question
 * of every candidate cycle at once (loadCycleList), where one query per cycle would be an
 * N+1 on every page load.
 *
 * SAME RULE, deliberately stated twice: live, non-deleted rows at status='draft', scoped by
 * client as well as cycle. It is duplicated rather than delegated because the single-cycle
 * form's exact query shape is asserted by draft-reader.test.ts — it pins the ownership
 * scoping, which is a security property, not an implementation detail. The two must change
 * together; if a third caller appears, collapse them and update that test deliberately.
 */
export async function cyclesWithReviewableDraft(clientId: string, cycleIds: readonly string[]): Promise<Set<string>> {
  if (cycleIds.length === 0) return new Set();          // inArray([]) is not valid SQL
  const rows = await db
    .selectDistinct({ cycleId: contentCyclePosts.cycleId })
    .from(contentCyclePosts)
    .where(and(
      inArray(contentCyclePosts.cycleId, [...cycleIds]),
      eq(contentCyclePosts.clientId, clientId),          // ownership — never trust the id alone
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ));
  return new Set(rows.map((r) => r.cycleId));
}

/**
 * Guard for the read path: may THIS client read THIS cycle? True if the cycle belongs to
 * the client AND it is not 'out_of_sync' AND it has either committed posts OR a
 * reviewable draft. The caller allows the home cycle unconditionally; this covers every
 * OTHER cycle, so a forged ?cycleId= for another client (or an out_of_sync surface) is
 * refused.
 *
 * The committed-post count keeps its draft fence untouched (Build A): drafts still do not
 * make a cycle readable *as a plan*. They make it readable as a DRAFT, via the separate
 * predicate above. An empty cycle — no posts, no drafts — remains unreadable.
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
      excludeDraftPosts(),                       // draft beats do not make a cycle readable
    ))
    .where(and(
      eq(contentCycles.id, cycleId),
      eq(contentCycles.clientId, clientId),      // ownership — never trust the id alone
    ))
    .groupBy(contentCycles.id, contentCycles.postsSyncStatus);

  if (!row) return false;                        // not this client's cycle, or nonexistent
  if (row.syncStatus === 'out_of_sync') return false;
  if (row.liveCount > 0) return true;            // has a committed plan
  return cycleHasReviewableDraft(clientId, cycleId);   // …or a draft worth reviewing
}

/**
 * Resolve the SURFACE KIND for one cycle. (Build E)
 *
 * The single server-side computation of "which surface does this cycle get". Both callers
 * use it — the first paint (`page.tsx`) and the month switch (`GET /api/plan`) — so a
 * client who lands on a draft and one who navigates to it cannot end up in different
 * shells. The client never decides; it is told, and follows.
 *
 * Laziness is preserved exactly as `page.tsx` had it: `mayHaveDraftSurface` gates the
 * draft read, so a cycle with committed posts never pays for `loadDraftBeats`.
 *
 * `committedPostCount` is passed in rather than re-queried because both callers have
 * already loaded the fenced post list for this cycle; re-counting could only disagree
 * with the list actually being rendered.
 */
export async function surfaceForCycle(params: {
  clientId:           string;
  cycleId:            string;
  committedPostCount: number;
  planRedesign:       boolean;
}): Promise<{ kind: SurfaceKind; draftBeats: DraftBeatView[] }> {
  const draftBeats = mayHaveDraftSurface({ hasSession: true, committedPostCount: params.committedPostCount })
    ? await loadDraftBeats(params.clientId, params.cycleId)
    : [];

  const kind = resolveSurfaceKind({
    hasSession:         true,
    committedPostCount: params.committedPostCount,
    draftBeatCount:     draftBeats.length,
    planRedesign:       params.planRedesign,
  });

  return { kind, draftBeats };
}

/**
 * Everything the draft surface needs beyond its beats, for ONE cycle.
 *
 * Exists so the month switch can enter draft mode client-side without the committed
 * payload ever carrying draft data: `GET /api/plan/draft` serves this, and it remains the
 * only reader permitted to see draft rows. monthLabel is deliberately absent — the client
 * already has it from the cycle list, and duplicating it would give two sources for one
 * label.
 */
export async function loadDraftSurfaceContext(clientId: string, cycleId: string, channel: string): Promise<{
  pillars:  string[];
  editable: boolean;
  receipts: DraftApplication[];
}> {
  const [planCfg] = await db
    .select({ pillars: clientPlanningConfig.pillars })
    .from(clientPlanningConfig)
    .where(and(eq(clientPlanningConfig.clientId, clientId), eq(clientPlanningConfig.channel, channel)))
    .limit(1);

  const pillars = (planCfg?.pillars ?? [])
    .map((p) => (p as { name?: unknown }).name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);

  // Past cutoff the draft stays READABLE but not editable — viewing and editing are
  // different rights (the same split cycleHasReviewableDraft exists for).
  return { pillars, editable: await cycleIsPreCutoff(cycleId), receipts: await loadReceipts(cycleId) };
}
