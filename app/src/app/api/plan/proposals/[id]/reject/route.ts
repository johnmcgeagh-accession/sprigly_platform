/**
 * POST /api/plan/proposals/:id/reject — reject a pending proposal. Idempotent.
 * Client-scoped.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { rejectProposal } from '@/lib/agent/proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const proposal = await rejectProposal(session.clientId, params.id, 'client');
  if (!proposal) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ proposal });
}
