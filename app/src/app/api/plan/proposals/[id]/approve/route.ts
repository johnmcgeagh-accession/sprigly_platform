/**
 * POST /api/plan/proposals/:id/approve — approve + apply a proposal.
 * Idempotent (double-approve never double-applies). Client-scoped.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { approveProposal } from '@/lib/agent/proposals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const r = await approveProposal(session.clientId, params.id, 'client');
  if (!r.proposal) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // A rewrite approval enqueues a shape job; the client polls jobId to see the
  // new caption. move/delete/add applied synchronously (no jobId).
  return NextResponse.json({ proposal: r.proposal, ...(r.jobId ? { jobId: r.jobId } : {}) });
}
