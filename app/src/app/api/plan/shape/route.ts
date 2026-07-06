/**
 * POST /api/plan/shape — plan-scope shaping. The main case is writing the caption
 * for a draft the app already created structurally (Phase 2 "add a post about X").
 * Body: { targetPostId, instruction }. Enqueues a `shape` job; returns pending.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueShape } from '@/lib/queue';
import { getUsageForCycle, isRewriteBlocked } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let targetPostId = '', instruction = '';
  try {
    const b = (await req.json()) as { targetPostId?: unknown; instruction?: unknown };
    targetPostId = String(b.targetPostId ?? '');
    instruction  = String(b.instruction ?? '').trim();
  } catch { /* below */ }
  if (!targetPostId || !instruction) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // AI caption-gen counts — enforce the monthly limit before any spend.
  const usage = await getUsageForCycle(session.clientId, session.cycleId);
  if (isRewriteBlocked(usage)) {
    return NextResponse.json({
      mode: 'blocked',
      summary: `You’ve used all ${usage.limit} AI changes this month — resets on the 1st. Editing directly stays free.`,
      usage,
    });
  }

  const r = await enqueueShape({
    type: 'shape', scope: 'plan', clientId: session.clientId, cycleId: session.cycleId, targetPostId, instruction, source: 'web',
  });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'Still working on the last change to this post — one moment.' });

  return NextResponse.json({ mode: 'pending', summary: 'Sprigly is writing this…', jobId: r.jobId });
}
