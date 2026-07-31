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
export type SpanReason = 'viewed' | 'adjacent' | 'now' | 'reachable';

export interface SpanCycle {
  cycleId:   string;
  /** The month this cycle PLANS, 'YYYY-MM' — never the stored `cycle_month`. */
  planMonth: string;
  status:    string;
  reason:    SpanReason;
}

export interface ContextCycle extends SpanCycle {
  posts: PlanPost[];
  /**
   * Is this month PRINTED in the digest?
   *
   * ── THE DIGEST AND THE RESOLUTION SET ARE DIFFERENT THINGS (F2) ────────────────────
   *
   * They used to be the same list, and that is what made cross-month one-way: from the October
   * view the span reached August (the now-rule), so an August post resolved; from the August
   * view it did not reach October, so *"move the post on the 16th of October to the 19th"*
   * could not find a post and the turn said so.
   *
   * The digest is what the model BROWSES — it costs tokens, so it is the span. The resolution
   * set is what a reference may REACH, and a reference does not need to have been browsed:
   * the client said "the 16th of October" out of their own head. Every month the client can
   * still act in is loaded; only the span is printed.
   */
  inDigest: boolean;
}

export interface PlanContext {
  today:         string;
  viewedCycleId: string;
  /** The viewed cycle's plan month, 'YYYY-MM'. Null when the cycle row is missing. */
  viewedMonth:   string | null;
  /** Every LOADED cycle, ascending by plan month. `inDigest` says which are printed. */
  cycles:        ContextCycle[];
  /**
   * Every post the agent may resolve a reference to, ascending by date — THE RESOLUTION SET.
   * A selector, a postId or a date resolves against this, and a reference can only ever reach
   * a post that is in it. Wider than the digest by design (F2): the client can name a month
   * they are not looking at, and did.
   */
  posts:         PlanPost[];
  /** The prompt block: the window line naming every month in the SPAN, then its rows. */
  digest:        string;
  /** Plan months printed in the digest, ascending. */
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
  const RANK: Record<SpanReason, number> = { viewed: 4, adjacent: 3, now: 2, reachable: 1 };
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
  const printed = cycles.filter((c) => c.inDigest);
  const months = printed.map((c) => c.planMonth);
  const head = planWindowLine(months);
  if (!printed.length) return head ?? '(no plan months on record)';

  const blocks = printed.map((c) => {
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
 * WHICH MONTHS A REFERENCE MAY REACH (F2).
 *
 * Every cycle whose plan month is not already over — from the month BEFORE today's onward. The
 * lower bound is what keeps this from growing without limit on a long-lived client: a post in a
 * finished month is read-only anyway (`isEditableDate`), so a reference to one can only ever be
 * refused, and loading a year of history to refuse it is spend with no outcome. One month of
 * slack below today, because "the post on the 29th" said on the 1st is usually last month's.
 *
 * Ascending, so a lookup that has to choose meets the nearest month first.
 */
export function resolutionCycles(rows: readonly CycleRow[], today: string): SpanCycle[] {
  const floor = previousMonth(today.slice(0, 7));
  return [...rows]
    .map((r) => ({ cycleId: r.id, planMonth: planMonthOf(r.month), status: r.status, reason: 'reachable' as SpanReason }))
    .filter((c) => c.planMonth >= floor)
    .sort((a, b) => a.planMonth.localeCompare(b.planMonth));
}

/** 'YYYY-MM' → the month before it. */
function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return (m ?? 1) === 1 ? `${(y ?? 2026) - 1}-12` : `${y}-${String((m ?? 1) - 1).padStart(2, '0')}`;
}

/**
 * Build the agent's plan context for one turn.
 *
 * One query for the cycle rows, then one `loadPlanPosts` per REACHABLE cycle. It is N+1 by
 * construction and deliberately so: `loadPlanPosts` is the ONE read that applies the draft fence
 * (`excludeDraftPosts`) and folds in the checklist, and a bespoke multi-cycle query here would be
 * a second definition of "what is the plan" that could disagree with the first.
 *
 * ── The cost, stated ─────────────────────────────────────────────────────────────────
 *
 * Before F2 this loaded the span (≤5). It now loads every month from last month onward, because
 * the resolution set has to be wider than the digest — see `ContextCycle.inDigest`. A cycle is a
 * monthly planning run, so that is the client's live months and no more: five or six for the
 * operator, and bounded below by the date gate rather than by a cap nobody would see hit. The
 * extra reads are indexed and land on a path that already makes a Bedrock call; the digest — the
 * part that costs tokens on every turn — is unchanged.
 */
export async function buildPlanContext(
  clientId: string, viewedCycleId: string, today: string,
): Promise<PlanContext> {
  const rows = await listClientCycles(clientId);
  const span = selectSpan(rows, viewedCycleId, today);
  const inSpan = new Map(span.map((c) => [c.cycleId, c] as const));

  // The union: everything reachable, plus anything the span picked that the floor excluded (a
  // viewed month in the past is still the month on screen, and its rows must be listed).
  const reachable = resolutionCycles(rows, today);
  const wanted = new Map<string, SpanCycle>();
  for (const c of reachable) wanted.set(c.cycleId, inSpan.get(c.cycleId) ?? c);
  for (const c of span) wanted.set(c.cycleId, c);

  const cycles: ContextCycle[] = (await Promise.all(
    [...wanted.values()]
      .sort((a, b) => a.planMonth.localeCompare(b.planMonth))
      .map(async (c) => ({ ...c, inDigest: inSpan.has(c.cycleId), posts: await loadPlanPosts(clientId, c.cycleId) })),
  ));

  const posts = cycles.flatMap((c) => c.posts).sort((a, b) => a.date.localeCompare(b.date));
  return {
    today,
    viewedCycleId,
    viewedMonth: cycles.find((c) => c.cycleId === viewedCycleId)?.planMonth ?? null,
    cycles,
    posts,
    digest: spanDigest(cycles, today, viewedCycleId),
    months: cycles.filter((c) => c.inDigest).map((c) => c.planMonth),
    allMonths: describeCycles(rows, viewedCycleId, cycles.filter((c) => c.inDigest).map((c) => c.cycleId)),
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
