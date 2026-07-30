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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(yyyymm);
  if (!m) return yyyymm;
  return `${MONTH_NAMES[Number(m[2]) - 1] ?? yyyymm} ${m[1]}`;
}

export interface CycleRow { id: string; month: string; status: string }

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
 */
export function describeCycles(rows: readonly CycleRow[], viewedCycleId: string): string {
  if (!rows.length) return '- (no cycles on record)';
  return [...rows]
    .map((r) => ({ ...r, plan: planMonthOf(r.month) }))
    .sort((a, b) => a.plan.localeCompare(b.plan))
    .map((r) => `- ${monthLabel(r.plan)} (${r.plan})${r.id === viewedCycleId ? ' [the month on screen]' : ''} — ${r.status}`)
    .join('\n');
}

/** Formatted list of the client's months for the parser prompt, named by what they plan. */
export async function getClientCycleMonths(clientId: string, viewedCycleId: string): Promise<string> {
  const rows = await db
    .select({ id: contentCycles.id, month: contentCycles.cycleMonth, status: contentCycles.status })
    .from(contentCycles)
    .where(eq(contentCycles.clientId, clientId));
  return describeCycles(rows, viewedCycleId);
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
  const rows = await db
    .select({ id: contentCycles.id, month: contentCycles.cycleMonth })
    .from(contentCycles)
    .where(eq(contentCycles.clientId, clientId));
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

/** Monday-anchored start of the week containing `d` (local). */
function weekStart(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Posts in the same week as `today` (Monday-anchored). */
export function currentWeekPosts(posts: PlanPost[], today: Date): PlanPost[] {
  const mon = weekStart(today);
  const next = new Date(mon); next.setDate(mon.getDate() + 7);
  const from = iso(mon), to = iso(next);
  return posts.filter((p) => p.date >= from && p.date < to).sort((a, b) => a.date.localeCompare(b.date));
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
 */
export function cycleDigest(posts: PlanPost[], today?: string): string {
  if (!posts.length) return '(no posts in this plan yet)';
  return [...posts]
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

/** Bucket a cycle's live posts into this-week / next-week and tally statuses. */
export function bucketCycleState(posts: PlanPost[], today: Date): CycleState {
  const mon = weekStart(today);
  const nextMon = new Date(mon); nextMon.setDate(mon.getDate() + 7);
  const weekAfter = new Date(mon); weekAfter.setDate(mon.getDate() + 14);
  const thisFrom = iso(mon), nextFrom = iso(nextMon), nextTo = iso(weekAfter);

  const thisWeek = posts.filter((p) => p.date >= thisFrom && p.date < nextFrom);
  const nextWeek = posts.filter((p) => p.date >= nextFrom && p.date < nextTo);

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
  const summary = [
    `TODAY IS ${todayIso}. A date is in the FUTURE if it is later than that, and in the PAST only if it is earlier. Compare the ISO dates.`,
    `Plan has ${posts.length} live posts (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}).`,
    byDate.length ? 'Posts (by date):' : '(no posts scheduled yet)',
    ...byDate.map(line),
  ].join('\n');

  return { summary, thisWeek, nextWeek, counts };
}

/** Load the session cycle's posts and bucket them relative to `today`. */
export async function readCycleState(clientId: string, cycleId: string, today: Date): Promise<CycleState> {
  const posts = await loadPlanPosts(clientId, cycleId);
  return bucketCycleState(posts, today);
}
