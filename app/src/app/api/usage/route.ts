/**
 * GET /api/usage?cycleId= — AI-change usage for the VIEWED cycle this calendar month.
 * { used, limit, overrideUntil, resetsOn, unlimited }. Structural edits are free and
 * never appear here; this only reflects rewrites/regen.
 *
 * Edits now debit the EDITED post's cycle (date-based editing across months), so the
 * badge must reflect the cycle the client is LOOKING AT — not the token's home cycle
 * (session.cycleId), whose channel/limit can differ. usePlanData sends the viewed
 * cycleId and refreshes on cycle switch. The cycleId is validated for client ownership
 * (same guard as /api/jobs); an unowned cycleId is refused (403, never leaks another
 * client's usage). Absent cycleId ⇒ the session's home cycle.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { getUsageForCycle } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  // A viewed cycleId different from home must belong to the session client — the same
  // ownership check the jobs route uses. A forged / other-client cycle never resolves → 403.
  const requested = new URL(req.url).searchParams.get('cycleId');
  let cycleId = session.cycleId;
  if (requested && requested !== session.cycleId) {
    const [owned] = await db
      .select({ id: contentCycles.id })
      .from(contentCycles)
      .where(and(eq(contentCycles.id, requested), eq(contentCycles.clientId, session.clientId)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    cycleId = requested;
  }

  const usage = await getUsageForCycle(session.clientId, cycleId);
  return NextResponse.json(usage);
}
