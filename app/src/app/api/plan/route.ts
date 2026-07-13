/**
 * GET /api/plan[?cycleId=] — returns a plan as PlanPost[]. Without a cycleId it
 * serves the session's home cycle (editable). With one, it serves another of the
 * SAME client's cycles read-only — verified server-side: the cycle must belong to
 * the session's client and qualify (isCycleReadableByClient), else 403. A pure
 * read: no cookie/session mutation, and WRITE scope stays the session's home cycle.
 * 401 if no valid session.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { loadPlanPosts, loadCrossMonthPosts, isCycleReadableByClient, beatsInMonth } from '@/lib/plan';
import { nextMonth } from '@/lib/cycle-nav';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 });
  }

  const requested = new URL(req.url).searchParams.get('cycleId');
  const cycleId   = requested ?? session.cycleId;
  const isHome    = cycleId === session.cycleId;

  // The home cycle is always allowed. Any other cycle must be verified to belong to
  // this client and be a valid live surface — otherwise refuse, never leak.
  if (!isHome && !(await isCycleReadableByClient(session.clientId, cycleId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const posts = await loadPlanPosts(session.clientId, cycleId);

  // Calendar grid is date-authoritative: also return the client's posts from OTHER cycles
  // dated within THIS cycle's plan month, so a cross-month-moved post shows on its date in
  // the month view it belongs to (each carries its own cycleId for edit routing).
  const [cyc] = await db
    .select({ channel: contentCycles.channel, cycleMonth: contentCycles.cycleMonth, structuredBrief: contentCycles.structuredBrief })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, session.clientId)))
    .limit(1);
  const viewedMonth = cyc ? nextMonth(cyc.cycleMonth) : '';
  const crossMonthPosts = cyc
    ? await loadCrossMonthPosts(session.clientId, cyc.channel, viewedMonth, cycleId)
    : [];
  // Beats: the VIEWED cycle's structured_brief dated in the viewed month (null-safe → []).
  // Viewed-cycle-only (cross-cycle brief beats not merged — see Build 3 report).
  const beats = cyc ? beatsInMonth(cyc.structuredBrief, viewedMonth) : [];

  return NextResponse.json({ posts, crossMonthPosts, beats, readOnly: !isHome });
}
