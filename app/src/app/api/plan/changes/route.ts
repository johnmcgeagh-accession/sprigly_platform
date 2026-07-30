/**
 * GET /api/plan/changes?cycleId=&since= — recent receipt-worthy changes for the viewed month,
 * from the existing plan_activity ledger (plan-changes.ts). Read-only; drives the day dots'
 * recently-changed state and the "What changed" row. The cycle id comes from the browser, so it
 * is checked, not trusted.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cycleBelongsToClient } from '@/lib/agent/cycle-state';
import { loadRecentChanges } from '@/lib/plan-changes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const url = new URL(req.url);
  const requested = url.searchParams.get('cycleId') ?? '';
  const since = url.searchParams.get('since');
  const cycleId =
    requested && requested !== session.cycleId && (await cycleBelongsToClient(session.clientId, requested))
      ? requested
      : session.cycleId;

  const changes = await loadRecentChanges(session.clientId, cycleId, since || null);
  return NextResponse.json({ changes });
}
