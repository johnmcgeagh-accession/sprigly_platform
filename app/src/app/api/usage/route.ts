/**
 * GET /api/usage — the session's AI-change usage this calendar month.
 * { used, limit, overrideUntil, resetsOn, unlimited }. Structural edits are free
 * and never appear here; this only reflects rewrites/regen.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getUsageForCycle } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const usage = await getUsageForCycle(session.clientId, session.cycleId);
  return NextResponse.json(usage);
}
