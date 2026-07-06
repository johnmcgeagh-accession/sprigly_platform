/**
 * agent/cycle-state.ts — structured reads of the client's cycles for the router
 * context and the query answerer. All scoped by clientId.
 */
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { loadPlanPosts } from '../plan';
import type { PlanPost } from '../types';
import type { CycleMonthContext } from './router';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(yyyymm);
  if (!m) return yyyymm;
  return `${MONTH_NAMES[Number(m[2]) - 1] ?? yyyymm} ${m[1]}`;
}

/** The client's known cycle-months, home (editable) first — router context. */
export async function getClientCycleMonths(clientId: string, homeCycleId: string): Promise<CycleMonthContext[]> {
  const rows = await db
    .select({ id: contentCycles.id, month: contentCycles.cycleMonth, status: contentCycles.status })
    .from(contentCycles)
    .where(eq(contentCycles.clientId, clientId));
  return rows
    .map((r) => ({ month: r.month, label: monthLabel(r.month), status: r.status, isHome: r.id === homeCycleId }))
    .sort((a, b) => (a.isHome === b.isHome ? a.month.localeCompare(b.month) : a.isHome ? -1 : 1));
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

export interface CycleState {
  summary: string;                 // compact text for the query prompt
  thisWeek: PlanPost[];
  nextWeek: PlanPost[];
  counts: Record<string, number>;  // by status
}

/** Monday-anchored start of the week containing `d` (local). */
function weekStart(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Bucket a cycle's live posts into this-week / next-week and tally statuses,
 * relative to `today`. Pure over the posts array so the bucketing is testable.
 */
export function bucketCycleState(posts: PlanPost[], today: Date): CycleState {
  const thisMon = weekStart(today);
  const nextMon = new Date(thisMon); nextMon.setDate(thisMon.getDate() + 7);
  const weekAfter = new Date(thisMon); weekAfter.setDate(thisMon.getDate() + 14);
  const thisFrom = iso(thisMon), nextFrom = iso(nextMon), nextTo = iso(weekAfter);

  const thisWeek = posts.filter((p) => p.date >= thisFrom && p.date < nextFrom);
  const nextWeek = posts.filter((p) => p.date >= nextFrom && p.date < nextTo);

  const counts: Record<string, number> = {};
  for (const p of posts) counts[p.status] = (counts[p.status] ?? 0) + 1;

  const line = (p: PlanPost) => `  - ${p.date} (${p.format}, ${p.pillar || 'no pillar'}): ${(p.caption || '').slice(0, 80)}`;
  const summary = [
    `Plan has ${posts.length} live posts (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}).`,
    `This week (from ${thisFrom}):`,
    thisWeek.length ? thisWeek.map(line).join('\n') : '  (nothing scheduled)',
    `Next week (from ${nextFrom}):`,
    nextWeek.length ? nextWeek.map(line).join('\n') : '  (nothing scheduled)',
  ].join('\n');

  return { summary, thisWeek, nextWeek, counts };
}

/** Load the session cycle's posts and bucket them relative to `today`. */
export async function readCycleState(clientId: string, cycleId: string, today: Date): Promise<CycleState> {
  const posts = await loadPlanPosts(clientId, cycleId);
  return bucketCycleState(posts, today);
}
