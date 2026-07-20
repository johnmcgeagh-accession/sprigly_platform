/**
 * POST /api/plan/draft/approve — turn a draft month into the committed plan.
 *
 * The one door that spends money. Approval flips every beat to 'generating' and fans
 * generation out, so the route is deliberately narrow: no options, no partial approval, no
 * body at all. Identity comes from the session; the cycle is the session's.
 *
 * Approval and fan-out are separate steps on purpose. Approval is the atomic state change;
 * the fan-out is best-effort work that follows it. If enqueuing some posts fails, the month
 * is still approved and those posts are individually retryable — a queue hiccup must not
 * leave the client's month in limbo.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { approveDraft } from '@/lib/draft-approval';
import { startPhase2 } from '@/lib/phase2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  no_cycle:         404,
  no_draft:         409,
  mixed_state:      409,
  already_approved: 409,
  cutoff_passed:    409,
};

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const approval = await approveDraft({ clientId: session.clientId, cycleId: session.cycleId });
  if (!approval.ok) {
    return NextResponse.json(
      { ok: false, error: approval.error, message: approval.message },
      { status: STATUS[approval.error] ?? 400 },
    );
  }

  const fanout = await startPhase2(session.clientId, session.cycleId);
  return NextResponse.json({
    ok: true,
    approved: approval.approved,
    captionsQueued: fanout.captionsQueued,
    hooksQueued: fanout.hooksQueued,
    failed: fanout.failed.length,
  });
}
