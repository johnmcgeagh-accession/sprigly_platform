/**
 * GET /api/plan[?cycleId=] — returns a plan as PlanPost[]. Without a cycleId it
 * serves the session's home cycle (editable). With one, it serves another of the
 * SAME client's cycles read-only — verified server-side: the cycle must belong to
 * the session's client and qualify (isCycleReadableByClient), else 403. A pure
 * read: no cookie/session mutation, and WRITE scope stays the session's home cycle.
 * 401 if no valid session.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { loadPlanPosts, isCycleReadableByClient } from '@/lib/plan';

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
  return NextResponse.json({ posts, readOnly: !isHome });
}
