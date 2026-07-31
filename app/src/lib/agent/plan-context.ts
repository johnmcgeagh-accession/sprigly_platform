/**
 * agent/plan-context.ts — THE SEAM: what does the agent know?
 *
 * ── Why this file exists at all ──────────────────────────────────────────────────────
 *
 * Every turn assembled its own context inline in `turn.ts`: one `loadPlanPosts` for the viewed
 * cycle, one `getCycleMonth`, one `cycleDigest`, and a list of month names. That is why the
 * agent could not act on August from the October view — not a permission rule anywhere, simply
 * that August's posts were never loaded, so every reference to them resolved to nothing and the
 * only honest answer was "I can't see that".
 *
 * X1 widens the context. It is a DELIBERATE INTERIM: the endgame is tool use — the agent
 * fetching what it needs per turn (roadmap Stage I, Bug 4) — and September's window is days
 * away, so the widening ships now. It ships behind ONE function so the migration is a swap of
 * this file's innards rather than an unpicking of the turn loop:
 *
 *     buildPlanContext(clientId, viewedCycleId, today)  →  PlanContext
 *
 * Every consumer of "what the agent knows" reads that object and nothing else. `turn.ts` no
 * longer calls `loadPlanPosts`, `getCycleMonth` or `getClientCycleMonths` directly; when the
 * context becomes a set of tools, the tools land HERE and every caller keeps its shape. The one
 * rule to preserve through that migration: `PlanContext.posts` is the resolution set — the posts
 * a reference may resolve to — and `PlanContext.cycles` is what maps a post or a date back to
 * the cycle that owns it. Both survive tool use; only how they are populated changes.
 *
 * ── THE SPAN, and why it is what it is ───────────────────────────────────────────────
 *
 * Two rules, unioned. Each is independently defensible, which is the point — a span that is
 * one arbitrary number would be re-argued every time a client had an unusual month layout.
 *
 *   1. WHERE THE CLIENT IS STANDING — the viewed cycle, and the cycle either side of it in the
 *      client's OWN month order (not calendar arithmetic: a client with a gap has neighbours
 *      across that gap, and those are the months "next"/"last" mean to them). This is what
 *      gives "move it to next month" and "bring it back" somewhere to land.
 *
 *   2. WHERE NOW IS — the cycle whose plan month contains TODAY, and the one containing
 *      today + 7 days. "Today", "this week" and "next week" are DATE words: they mean the same
 *      thing whatever month is on screen. A context that cannot see them can only answer by
 *      naming the months it can see, which is what the operator got when they asked "what's
 *      happening next week" on 31 July with October up.
 *
 * Typically that is three months; it is never more than five (viewed ±1 = 3, plus at most two
 * from rule 2, minus overlaps). Beyond ±1 is therefore reached only for the stated reason in
 * rule 2, which is the exception the brief asks to be justified rather than assumed.
 *
 * The cost is linear in months and sits entirely inside the parser's CACHED prefix
 * (`task-parser.ts` → the cache_point), so a five-month span is paid for once per plan change
 * rather than once per turn. It is still the reason tool use is the endgame and this is not.
 */
import { loadPlanPosts } from '../plan';
import { isEditableDate } from '../edit-scope';
import type { PlanPost } from '../types';
import { fmtDate, postTitle } from './selectors';
import { planMonthOf, planWindowLine, monthLabel, describeCycles, listClientCycles, type CycleRow } from './cycle-state';

/** Why a cycle is in the span. Carried so the prompt can say it and a fixture can assert it. */
export type SpanReason = 'viewed' | 'adjacent' | 'now';

export interface SpanCycle {
  cycleId:   string;
  /** The month this cycle PLANS, 'YYYY-MM' — never the stored `cycle_month`. */
  planMonth: string;
  status:    string;
  reason:    SpanReason;
}

export interface ContextCycle extends SpanCycle {
  posts: PlanPost[];
}

export interface PlanContext {
  today:         string;
  viewedCycleId: string;
  /** The viewed cycle's plan month, 'YYYY-MM'. Null when the cycle row is missing. */
  viewedMonth:   string | null;
  /** The span, ascending by plan month. */
  cycles:        ContextCycle[];
  /** Every post in the span, ascending by date — THE RESOLUTION SET. A selector, a postId or
   *  a date resolves against this, which is the whole of X1: a reference can only reach a post
   *  the context loaded. */
  posts:         PlanPost[];
  /** The prompt block: the window line naming every month in scope, then the rows. */
  digest:        string;
  /** Plan months in scope, ascending. */
  months:        string[];
  /** EVERY month the client has, formatted for the prompt — with the ones loaded below marked.
   *  The span says what is READABLE this turn; this says what EXISTS, and the two are different
   *  facts. Without the second, "add it to March" would read as impossible rather than as a
   *  month we did not load. */
  allMonths:     string;
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (local, DST-safe for whole days). */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y || 2026, (m || 1) - 1, (d || 1) + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * THE SPAN, as a pure function of the client's cycles + where they are standing + today.
 *
 * Pure so the rule can be tested without a database, and so the rule is readable in one place
 * rather than distributed across a query. Ascending by plan month; the viewed cycle always
 * present when it exists.
 */
export function selectSpan(
  rows: readonly CycleRow[], viewedCycleId: string, today: string,
): SpanCycle[] {
  const all = [...rows]
    .map((r) => ({ cycleId: r.id, planMonth: planMonthOf(r.month), status: r.status }))
    .sort((a, b) => a.planMonth.localeCompare(b.planMonth));
  if (!all.length) return [];

  const picked = new Map<string, SpanReason>();
  // A later rule never downgrades an earlier one: 'viewed' outranks 'adjacent' outranks 'now'.
  const RANK: Record<SpanReason, number> = { viewed: 3, adjacent: 2, now: 1 };
  const pick = (cycleId: string | undefined, reason: SpanReason) => {
    if (!cycleId) return;
    const cur = picked.get(cycleId);
    if (!cur || RANK[reason] > RANK[cur]) picked.set(cycleId, reason);
  };

  // Rule 1 — where the client is standing.
  const i = all.findIndex((c) => c.cycleId === viewedCycleId);
  if (i >= 0) {
    pick(all[i]!.cycleId, 'viewed');
    pick(all[i - 1]?.cycleId, 'adjacent');
    pick(all[i + 1]?.cycleId, 'adjacent');
  }

  // Rule 2 — where now is. The month containing today, and the month containing next week's
  // far end, because a week that straddles a month boundary lives in two cycles.
  const nowMonth  = today.slice(0, 7);
  const weekMonth = addDays(today, 7).slice(0, 7);
  pick(all.find((c) => c.planMonth === nowMonth)?.cycleId, 'now');
  pick(all.find((c) => c.planMonth === weekMonth)?.cycleId, 'now');

  return all.filter((c) => picked.has(c.cycleId)).map((c) => ({ ...c, reason: picked.get(c.cycleId)! }));
}

/**
 * The digest for a MULTI-MONTH span.
 *
 * Two things are different from the single-cycle `cycleDigest` it replaces, and both are the
 * brief's:
 *
 *   - the window line names EVERY month in scope, so the plan's extent is the span's extent and
 *     not one month's (G2's rule, generalised);
 *   - each month is its own headed block, so a date reference resolves to a month rather than to
 *     a bare day-of-month across three of them.
 *
 * Every row still carries its ISO date and the `[past — read-only]` marker computed with the
 * WRITE GATE'S OWN predicate (`isEditableDate`, edit-scope.ts) — the same rule the apply step
 * enforces, so the agent can never promise a change the gate will refuse, nor refuse one it
 * would allow.
 */
export function spanDigest(cycles: readonly ContextCycle[], today: string, viewedCycleId: string): string {
  const months = cycles.map((c) => c.planMonth);
  const head = planWindowLine(months);
  if (!cycles.length) return head ?? '(no plan months on record)';

  const blocks = cycles.map((c) => {
    const mark = c.cycleId === viewedCycleId ? ' [the month on screen]' : '';
    const rows = [...c.posts]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => {
        const past = isEditableDate(p.date, today) ? '' : ' | [past — read-only]';
        return `- id=${p.id} | ${p.date} (${fmtDate(p.date)})${past} | ${p.channel}/${p.format} | ${postTitle(p)}`;
      });
    return `${monthLabel(c.planMonth)} (${c.planMonth})${mark}:\n${rows.length ? rows.join('\n') : '  (no posts in this month yet)'}`;
  });

  return `${head ? `${head}\n\n` : ''}${blocks.join('\n\n')}`;
}

/**
 * Build the agent's plan context for one turn.
 *
 * One query for the cycle rows, then one `loadPlanPosts` per cycle in the span (≤5). It is N+1
 * by construction and deliberately so: `loadPlanPosts` is the ONE read that applies the draft
 * fence (`excludeDraftPosts`) and folds in the checklist, and a bespoke multi-cycle query here
 * would be a second definition of "what is the plan" that could disagree with the first. At five
 * cycles the cost is five indexed reads on a hot path that already makes a Bedrock call.
 */
export async function buildPlanContext(
  clientId: string, viewedCycleId: string, today: string,
): Promise<PlanContext> {
  const rows = await listClientCycles(clientId);
  const span = selectSpan(rows, viewedCycleId, today);
  const cycles: ContextCycle[] = await Promise.all(
    span.map(async (c) => ({ ...c, posts: await loadPlanPosts(clientId, c.cycleId) })),
  );

  const posts = cycles.flatMap((c) => c.posts).sort((a, b) => a.date.localeCompare(b.date));
  return {
    today,
    viewedCycleId,
    viewedMonth: cycles.find((c) => c.cycleId === viewedCycleId)?.planMonth ?? null,
    cycles,
    posts,
    digest: spanDigest(cycles, today, viewedCycleId),
    months: cycles.map((c) => c.planMonth),
    allMonths: describeCycles(rows, viewedCycleId, cycles.map((c) => c.cycleId)),
  };
}

/**
 * The cycle a DATE belongs to — the mechanism behind "mutations resolve their own cycle" (X1b/c).
 *
 * A date's cycle is the cycle that PLANS its month. It is deliberately not "the viewed cycle"
 * and deliberately not "the nearest cycle": a post dated in a month nobody plans has no home,
 * and the honest answer to "add a post on 4 September" with no September cycle is to say so
 * rather than to file it under August and let it surface in a month view it does not belong to.
 */
export function cycleForDate(ctx: PlanContext, iso: string): ContextCycle | null {
  return ctx.cycles.find((c) => c.planMonth === iso.slice(0, 7)) ?? null;
}

/** The post, and the cycle that OWNS it — which is the post's own `cycleId`, never the viewed
 *  one. Every mutation the agent proposes is scoped with this. */
export function postById(ctx: PlanContext, id: string): PlanPost | null {
  return ctx.posts.find((p) => p.id === id) ?? null;
}
