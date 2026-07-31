/**
 * agent/cycle-state.ts — structured reads of the client's cycles for the task
 * parser (cycle months + this-week digest) and the query answerer. Client-scoped.
 */
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { loadPlanPosts } from '../plan';
import { isEditableDate } from '../edit-scope';
import type { PlanPost } from '../types';
import { fmtDate, parseISO, postTitle } from './selectors';
import { weekLines, weekWindows } from './weeks';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export function monthLabel(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(yyyymm);
  if (!m) return yyyymm;
  return `${MONTH_NAMES[Number(m[2]) - 1] ?? yyyymm} ${m[1]}`;
}

export interface CycleRow { id: string; month: string; status: string }

/** Days in the month of 'YYYY-MM'. Day 0 of the NEXT month is the last day of this one. */
function daysInMonth(month: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return 31;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

/**
 * ── THE PLAN'S BOUNDARY IS THE CALENDAR, NOT THE LAST POST (G2) ──────────────────────
 *
 * The Earl of East October case: the agent told the client the plan "runs up to the 28th" and
 * refused later dates. There is no such rule anywhere in this codebase — a post may be added
 * on any date from today onwards (`add-policy.ts`), and the cycle plans a whole calendar month.
 *
 * The sentence came from the only evidence the model had. Both context builders below listed
 * the posts and nothing else, so the plan's extent was inferrable ONLY as max(scheduled_date):
 * the last post was the 28th, so the plan ended on the 28th. A gap at the end of a month read
 * as the end of the month.
 *
 * So the window is STATED. One line, computed from the plan month's own calendar, saying where
 * the plan begins and ends and that an empty date inside it is empty rather than absent. It
 * costs a line of prompt and closes the whole class: the same reasoning would have refused the
 * 30th of a month whose last post was the 27th, on any month, for any client.
 *
 * ── IT NAMES EVERY MONTH IN SCOPE, NOT ONE (X1a) ─────────────────────────────────────
 *
 * The agent's context now spans several cycles (`plan-context.ts`). A window line naming one of
 * them would be worse than none: it would state a boundary the digest underneath plainly
 * crosses, and the model would have to choose which to believe. It takes a LIST, and the single
 * month remains the one-element case — every existing caller is unchanged.
 */
export function planWindowLine(planMonths: string | readonly string[] | null | undefined): string | null {
  const months = (typeof planMonths === 'string' ? [planMonths] : planMonths ?? [])
    .filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m));
  if (!months.length) return null;
  const spans = months.map((m) => `${m}-01 to ${m}-${String(daysInMonth(m)).padStart(2, '0')} (${monthLabel(m)})`);
  const covers = months.length === 1
    ? `THIS PLAN COVERS ${spans[0]} — the whole month.`
    : `YOU CAN SEE ${months.length} MONTHS OF THIS PLAN, IN FULL: ${spans.join('; ')}. `
      + `A date in ANY of these months is a date you can act on — the month on screen is where the client is looking, not the limit of what you may change.`;
  return `${covers} `
    + `A plan does NOT end at its last post: a date inside these windows with no post on it is an EMPTY date in the plan, `
    + `not a date outside it. Never tell the client the plan "runs up to" the last scheduled post, and never refuse a date `
    + `for being later than one.`;
}

/**
 * The month a cycle PLANS, from the month its data covers.
 *
 * `contentCycles.cycleMonth` is the DATA month; the plan it produces is dated a month later
 * (`plan.ts:250`, `displayMonth = nextMonth(cycleMonth)`). Everything the client sees is the
 * plan month, so everything the agent SAYS has to be too — the prompt used to print the data
 * month beside a digest of the plan month's posts, which is how the agent came to tell a client
 * looking at September that it could "only edit posts in the current September 2026 cycle" and,
 * in the same breath, that its digest started on 1 October.
 */
export function planMonthOf(cycleMonth: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(cycleMonth);
  if (!m) return cycleMonth;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
}

/**
 * The client's months, as the parser reads them. Pure, so the shape can be tested without a db.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT SAY.
 *
 * It does not call any cycle "editable", because a cycle is not the unit of editability — a DATE
 * is. Every one of the client's months is browsable and every future-dated post in them is
 * changeable (`edit-scope.ts`), and the old "[current, editable]" marker taught the parser the
 * opposite: that one month was the only one it could act on. That is the sentence the client got
 * back.
 *
 * It does not hide the past or the far future either. Adjacent months have to be listed or a
 * cross-month intent — "push it into next month" — has nowhere to resolve to.
 *
 * The VIEWED cycle is marked, and it is marked as *the month on screen* rather than as a
 * permission: it tells the parser where the client's attention is, which is what a bare reference
 * like "the 5th" needs, without implying that anything else is off limits.
 *
 * `loadedCycleIds` (X1a) marks the months whose POSTS are in this turn's digest. A month that
 * exists but is not loaded is still a month the client owns and still a valid destination for an
 * add or a move — it simply has no rows to resolve a reference against, and saying which is which
 * is what stops "add it to March" reading as "March does not exist".
 */
export function describeCycles(
  rows: readonly CycleRow[], viewedCycleId: string, loadedCycleIds?: readonly string[],
): string {
  if (!rows.length) return '- (no cycles on record)';
  const loaded = loadedCycleIds ? new Set(loadedCycleIds) : null;
  return [...rows]
    .map((r) => ({ ...r, plan: planMonthOf(r.month) }))
    .sort((a, b) => a.plan.localeCompare(b.plan))
    .map((r) => `- ${monthLabel(r.plan)} (${r.plan})${r.id === viewedCycleId ? ' [the month on screen]' : ''}`
      + `${loaded ? (loaded.has(r.id) ? ' [posts listed below]' : ' [posts NOT listed — you can still add or move INTO this month]') : ''} — ${r.status}`)
    .join('\n');
}

/**
 * The client's cycle rows — the ONE read behind every "which months does this client have?"
 * question. Named and exported because the context builder (`plan-context.ts`) needs the same
 * rows the month list needs, and two queries for one fact is how they come to disagree.
 */
export async function listClientCycles(clientId: string): Promise<CycleRow[]> {
  return db
    .select({ id: contentCycles.id, month: contentCycles.cycleMonth, status: contentCycles.status })
    .from(contentCycles)
    .where(eq(contentCycles.clientId, clientId));
}

/** Formatted list of the client's months for the parser prompt, named by what they plan. */
export async function getClientCycleMonths(clientId: string, viewedCycleId: string): Promise<string> {
  return describeCycles(await listClientCycles(clientId), viewedCycleId);
}

/**
 * The month this cycle PLANS ('YYYY-MM'), or null if the row is missing.
 *
 * It returns the plan month, not the stored `cycle_month`. Every caller wants the month the
 * posts are dated in — the one caller that did not know the difference compared a post's date
 * against the data month and therefore refused every in-month move.
 */
export async function getCycleMonth(clientId: string, cycleId: string): Promise<string | null> {
  const [row] = await db
    .select({ month: contentCycles.cycleMonth })
    .from(contentCycles)
    .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.id, cycleId)))
    .limit(1);
  return row?.month ? planMonthOf(row.month) : null;
}

/** Resolve a PLAN month ('YYYY-MM') to one of the client's cycle ids, or null if none exists. */
export async function resolveCycleForMonth(clientId: string, planMonth: string): Promise<string | null> {
  const rows = await listClientCycles(clientId);
  return rows.find((r) => planMonthOf(r.month) === planMonth)?.id ?? null;
}

/**
 * Does this cycle belong to this client? The viewed cycle arrives from the CLIENT now, so it is
 * checked rather than trusted — the same rule every other write path on this surface follows.
 */
export async function cycleBelongsToClient(clientId: string, cycleId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contentCycles.id })
    .from(contentCycles)
    .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.id, cycleId)))
    .limit(1);
  return !!row;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Posts in the same week as `today`.
 *
 * The Monday anchor is `weeks.ts`'s (F1). It used to be a private `weekStart` here — correct, but
 * a second copy of a definition that also has to appear in two prompts, and the prompts are where
 * it went wrong. One function now, and the words the model reads are printed from it.
 */
export function currentWeekPosts(posts: PlanPost[], today: Date): PlanPost[] {
  const { from, to } = weekWindows(iso(today)).thisWeek;
  return posts.filter((p) => p.date >= from && p.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compact digest of the WHOLE cycle's posts (the viewed plan month), by date, WITH ids — the
 * parser resolves references like "the post from the 1st August" or "the Thursday reel" against
 * this. NOT week-scoped: a move between two in-month dates must see the source post even when it
 * falls outside the current week (the "this week" heritage caused false "no posts" replies).
 *
 * ── EVERY DATE CARRIES ITS YEAR, AND ITS SIDE OF TODAY ───────────────────────────────
 *
 * It used to print `fmtDate` alone — `Fri 14 Aug`, with **no year**. The model was then asked
 * whether that date had passed, from a line that does not say which year it is in, and it
 * answered: *"The post on the 14th of August is in August 2026, which is in the past (today is
 * 30 July 2026)."* A future date, called past, in the same breath as the correct today.
 *
 * Nothing in the prompt had told it otherwise. So two things are stated here rather than left to
 * be derived: the ISO date, which is unambiguous and directly comparable against today; and
 * whether the row is `[past]`, computed with the SAME predicate the write gate uses
 * (`isEditableDate`, edit-scope.ts). The model no longer has to do date arithmetic to answer the
 * one question it was getting wrong — it reads the answer off the line.
 *
 * `today` is optional so the pure digest stays testable without it; omitted, no row is marked
 * (the ISO dates alone are still unambiguous).
 *
 * `planMonth` states the WINDOW this list sits inside — see `planWindowLine`. Without it the
 * only readable boundary is the last row, which is how "the plan runs up to the 28th" happened.
 */
export function cycleDigest(posts: PlanPost[], today?: string, planMonth?: string | null): string {
  const window = planWindowLine(planMonth);
  const head = window ? `${window}\n` : '';
  if (!posts.length) return `${head}(no posts in this plan yet)`;
  return head + [...posts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      const past = today && !isEditableDate(p.date, today) ? ' | [past — read-only]' : '';
      return `- id=${p.id} | ${p.date} (${fmtDate(p.date)})${past} | ${p.channel}/${p.format} | ${postTitle(p)}`;
    })
    .join('\n');
}

export interface CycleState {
  summary: string;
  thisWeek: PlanPost[];
  nextWeek: PlanPost[];
  counts: Record<string, number>;
}

/** Bucket a cycle's live posts into this-week / next-week and tally statuses. `planMonth`
 *  states the plan's calendar window in the summary — the query answerer reads ONLY this
 *  summary, so without it the plan's end is the last post (G2). */
export function bucketCycleState(posts: PlanPost[], today: Date, planMonth?: string | readonly string[] | null): CycleState {
  // Both windows from `weeks.ts` — the SAME function that prints them into the prompt below, so
  // the sentence the model reads and the posts it is given can never describe different weeks.
  const { thisWeek: tw, nextWeek: nw } = weekWindows(iso(today));
  const inWeek = (w: { from: string; to: string }) => (p: PlanPost) => p.date >= w.from && p.date <= w.to;

  const thisWeek = posts.filter(inWeek(tw));
  const nextWeek = posts.filter(inWeek(nw));

  const counts: Record<string, number> = {};
  for (const p of posts) counts[p.status] = (counts[p.status] ?? 0) + 1;

  // ── TODAY IS IN THE STATE, AND SO IS EACH ROW'S SIDE OF IT ─────────────────────────
  // This summary is the ENTIRE plan context the query answerer gets (query.ts), and it used to
  // contain no today at all — `today` was consumed here for bucketing and then thrown away. So
  // the one other path that can put free text in front of a client could not tell a past date
  // from a future one, and answered "is that in the past?" from nothing. Both facts are stated
  // now, and `[past]` is computed with the write gate's own predicate rather than re-derived.
  const todayIso = iso(today);
  const line = (p: PlanPost) => {
    const past = isEditableDate(p.date, todayIso) ? '' : ' [past — read-only]';
    return `  - ${p.date} (${fmtDate(p.date)})${past} (${p.format}, ${p.pillar || 'no pillar'}): ${(p.caption || '').slice(0, 80)}`;
  };
  // Full plan-month listing (not week-scoped) so the query answerer sees the whole cycle and can
  // answer any date/week question from the dates + today — never blinkered to "this week".
  const byDate = [...posts].sort((a, b) => a.date.localeCompare(b.date));
  const window = planWindowLine(planMonth);
  /**
   * ── THE WEEK IS STATED, NOT DERIVED (F1) ───────────────────────────────────────────
   *
   * Asked on Friday 31 July, the agent answered about 7–13 August: today + 7 through today + 13,
   * a rolling seven days. The buckets three lines above hold the right answer — Mon 3 to Sun 9 —
   * and this summary is ALL the query answerer reads, so until now that answer was computed and
   * discarded while the model was left to do calendar arithmetic it had no calendar for.
   *
   * `weekLines` prints the two windows; the counts beneath come from the buckets themselves, so
   * the prose and the data cannot disagree. Same treatment as `TODAY IS` and the plan window: the
   * model reads the answer off the line rather than working it out.
   */
  const weekCount = (label: string, list: PlanPost[]) =>
    `${label}: ${list.length} post${list.length === 1 ? '' : 's'}${list.length ? ` — ${list.map((p) => p.date).join(', ')}` : ''}.`;
  const summary = [
    `TODAY IS ${todayIso}. A date is in the FUTURE if it is later than that, and in the PAST only if it is earlier. Compare the ISO dates.`,
    weekLines(todayIso),
    weekCount('THIS WEEK holds', thisWeek),
    weekCount('NEXT WEEK holds', nextWeek),
    ...(window ? [window] : []),
    `Plan has ${posts.length} live posts (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}).`,
    byDate.length ? 'Posts (by date):' : '(no posts scheduled yet)',
    ...byDate.map(line),
  ].join('\n');

  return { summary, thisWeek, nextWeek, counts };
}

/** Load the session cycle's posts and bucket them relative to `today`. Reads the cycle's PLAN
 *  month too, so the summary can state the window rather than leave it to be inferred (G2). */
export async function readCycleState(clientId: string, cycleId: string, today: Date): Promise<CycleState> {
  const posts = await loadPlanPosts(clientId, cycleId);
  const planMonth = await getCycleMonth(clientId, cycleId).catch(() => null);
  return bucketCycleState(posts, today, planMonth);
}
