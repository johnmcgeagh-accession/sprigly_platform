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
  // A rewrite approval enqueues a shape job; the client polls jobId to see the new caption.
  // generate_hook returns hookPostId so the client polls the hook job into that post's hook
  // UI. `blocked` (with `message`) means a dependency wasn't met and the proposal was NOT
  // consumed — the client shows the message and keeps the row approvable. move/delete/add
  // apply synchronously.
  return NextResponse.json({
    proposal: r.proposal,
    ...(r.jobId ? { jobId: r.jobId } : {}),
    ...(r.hookPostId ? { hookPostId: r.hookPostId } : {}),
    ...(r.blocked ? { blocked: true } : {}),
    // `failed` + `message` is a REFUSAL that consumed the proposal (G3). It used to travel as
    // a bare 200 with `proposal.status:'failed'` and no words, which the client counted as a
    // success — the vanished launch post. Both halves ride now: that it failed, and why.
    ...(r.failed ? { failed: true } : {}),
    ...(r.message ? { message: r.message } : {}),
    // The post(s) this approval touched/created — the surface highlights them in the
    // what-changed treatment after a background apply (F4).
    ...(r.changedPostIds?.length ? { changedPostIds: r.changedPostIds } : {}),
  });
}
