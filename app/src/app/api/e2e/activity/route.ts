/**
 * GET /api/__e2e/activity[?postId=] — read the plan_activity ledger for the session's
 * client, newest first. TEST-ONLY: returns 404 unless the e2e fake gate is on
 * (SPRIGLY_E2E_FAKE=1 AND NODE_ENV !== 'production'), so it never exists in a real
 * deploy. Lets Playwright assert ledger rows without a DB driver.
 */
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, planActivity } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { e2eFakeEnabled } from '@/lib/e2e-fake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!e2eFakeEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const postId = new URL(req.url).searchParams.get('postId');
  const where = postId
    ? and(eq(planActivity.clientId, session.clientId), eq(planActivity.postId, postId))
    : eq(planActivity.clientId, session.clientId);

  const rows = await db.select().from(planActivity).where(where).orderBy(desc(planActivity.createdAt));
  return NextResponse.json({
    activity: rows.map((r) => ({
      id: r.id, postId: r.postId, origin: r.origin, action: r.action,
      refProposalId: r.refProposalId, createdAt: r.createdAt,
    })),
  });
}
