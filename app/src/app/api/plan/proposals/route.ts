/**
 * GET /api/plan/proposals?status=pending — the client's pending agent proposals.
 * Client-scoped via the magic-link session. Returns { proposals: ProposalView[] }.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listPendingProposals } from '@/lib/agent/proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  // Only 'pending' is served (the review queue). Other statuses are historical.
  const status = new URL(req.url).searchParams.get('status') ?? 'pending';
  const proposals = status === 'pending' ? await listPendingProposals(session.clientId) : [];
  return NextResponse.json({ proposals });
}
