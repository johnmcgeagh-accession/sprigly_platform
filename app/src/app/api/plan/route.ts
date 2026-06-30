/**
 * GET /api/plan — returns the session's plan as PlanPost[]. Scoped server-side to
 * the cookie's client+cycle; no client-supplied ids are trusted. 401 if no valid
 * session.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { loadPlanPosts } from '@/lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 });
  }
  const posts = await loadPlanPosts(session.clientId, session.cycleId);
  return NextResponse.json({ posts });
}
