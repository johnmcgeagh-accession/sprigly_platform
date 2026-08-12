/**
 * POST /api/plan/draft/approve — turn a draft month into the committed plan.
 *
 * The one door that spends money. Approval flips every beat to 'generating' and fans
 * generation out, so the route is deliberately narrow: no options, no partial approval.
 *
 * ── THE CYCLE IS THE ONE ON SCREEN ───────────────────────────────────────────────────
 *
 * It used to be `session.cycleId` and the route took no body at all — "the cycle is the
 * session's". That was the most consequential instance of the link-scoping defect in the
 * codebase: a client browsing November on a September link who pressed Generate committed
 * SEPTEMBER, irreversibly, and paid Bedrock to write captions for a month they were not
 * looking at. Approval is the one call here with no undo, so it is the one that could least
 * afford to guess.
 *
 * The body now carries the viewed cycle and it is ownership-checked before anything is
 * committed (resolveWriteCycle). An unrecognised id is REFUSED rather than defaulted — for
 * every other route a silent fallback costs a wrong list, and here it would cost a wrong
 * month. An ABSENT id still falls back to the session's cycle, because that is what an older
 * client sends and refusing them would break approval outright rather than aim it.
 *
 * Approval and fan-out are separate steps on purpose. Approval is the atomic state change;
 * the fan-out is best-effort work that follows it. If enqueuing some posts fails, the month
 * is still approved and those posts are individually retryable — a queue hiccup must not
 * leave the client's month in limbo. Both now take the SAME resolved cycle: approving one
 * month and fanning out another would be worse than either error alone.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { approveDraft } from '@/lib/draft-approval';
import { startPhase2 } from '@/lib/phase2';
import { resolveWriteCycle, requestedCycleId } from '@/lib/write-cycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  no_cycle:         404,
  no_draft:         409,
  mixed_state:      409,
  already_approved: 409,
  cutoff_passed:    409,
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* body is optional */ }

  const target = await resolveWriteCycle(session, requestedCycleId(body));
  if (!target.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const cycleId = target.cycleId;

  const approval = await approveDraft({ clientId: session.clientId, cycleId });
  if (!approval.ok) {
    return NextResponse.json(
      { ok: false, error: approval.error, message: approval.message },
      { status: STATUS[approval.error] ?? 400 },
    );
  }

  // The SAME cycle the approval just committed — read from the local, never re-derived.
  const fanout = await startPhase2(session.clientId, cycleId);
  return NextResponse.json({
    ok: true,
    approved: approval.approved,
    captionsQueued: fanout.captionsQueued,
    hooksQueued: fanout.hooksQueued,
    failed: fanout.failed.length,
  });
}
