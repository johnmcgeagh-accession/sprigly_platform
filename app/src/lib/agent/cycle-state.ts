/**
 * agent/cycle-state.ts — structured reads of the client's cycles for the task
 * parser (cycle months + this-week digest) and the query answerer. Client-scoped.
 */
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { loadPlanPosts } from '../plan';
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

/** Formatted list of the client's cycle months (home first) for the parser prompt. */
export async function getClientCycleMonths(clientId: string, homeCycleId: string): Promise<string> {
  const rows = await db
    .select({ id: contentCycles.id, month: contentCycles.cycleMonth, status: contentCycles.status })
    .from(contentCycles)
    .where(eq(contentCycles.clientId, clientId));
  if (!rows.length) return '- (no cycles on record)';
  return rows
    .map((r) => ({ ...r, isHome: r.id === homeCycleId }))
    .sort((a, b) => (a.isHome === b.isHome ? a.month.localeCompare(b.month) : a.isHome ? -1 : 1))
    .map((r) => `- ${monthLabel(r.month)} (${r.month})${r.isHome ? ' [current, editable]' : ''} — ${r.status}`)
    .join('\n');
}

/** Resolve a 'YYYY-MM' to one of the client's cycle ids, or null if none exists. */
export async function resolveCycleForMonth(clientId: string, month: string): Promise<string | null> {
  const [row] = await db
    .select({ id: contentCycles.id })
    .from(contentCycles)
    .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.cycleMonth, month)))
    .limit(1);
  return row?.id ?? null;
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

/** Compact digest of this week's posts, WITH ids, so the parser can resolve
 *  references like "the Thursday reel" to a concrete id. */
export function weekDigest(posts: PlanPost[], today: Date): string {
  const week = currentWeekPosts(posts, today);
  if (!week.length) return '(no posts scheduled this week)';
  return week.map((p) => `- id=${p.id} | ${fmtDate(p.date)} | ${p.channel}/${p.format} | ${postTitle(p)}`).join('\n');
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

  const line = (p: PlanPost) => `  - ${fmtDate(p.date)} (${p.format}, ${p.pillar || 'no pillar'}): ${(p.caption || '').slice(0, 80)}`;
  const summary = [
    `Plan has ${posts.length} live posts (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}).`,
    `This week:`,
    thisWeek.length ? thisWeek.map(line).join('\n') : '  (nothing scheduled)',
    `Next week:`,
    nextWeek.length ? nextWeek.map(line).join('\n') : '  (nothing scheduled)',
  ].join('\n');

  return { summary, thisWeek, nextWeek, counts };
}

/** Load the session cycle's posts and bucket them relative to `today`. */
export async function readCycleState(clientId: string, cycleId: string, today: Date): Promise<CycleState> {
  const posts = await loadPlanPosts(clientId, cycleId);
  return bucketCycleState(posts, today);
}
