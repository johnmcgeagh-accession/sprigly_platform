/**
 * POST /api/plan/shape — plan-scope shaping. The main case is writing the caption
 * for a draft the app already created structurally (Phase 2 "add a post about X").
 * Body: { targetPostId, instruction }. Enqueues a `shape` job; returns pending.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueShape } from '@/lib/queue';
import { getUsageForCycle, isRewriteBlocked } from '@/lib/usage';
import { gatePostEdit, editScopeToday } from '@/lib/edit-scope';

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

  // DATE POLICY: gate by the target post's date + resolve its real cycle (the worker
  // locates the post by that cycle).
  const today = editScopeToday();
  const gate = await gatePostEdit(session.clientId, targetPostId, today);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const cycleId = gate.cycleId;

  // AI caption-gen counts — enforce the monthly limit before any spend (per the post's cycle).
  const usage = await getUsageForCycle(session.clientId, cycleId);
  if (isRewriteBlocked(usage)) {
    return NextResponse.json({
      mode: 'blocked',
      summary: `You’ve used all ${usage.limit} AI changes this month. Resets on the 1st. Editing directly stays free.`,
      usage,
    });
  }

  const r = await enqueueShape({
    type: 'shape', scope: 'plan', clientId: session.clientId, cycleId, targetPostId, instruction, source: 'web',
    actor: 'client',
  });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'Still working on the last change to this post. One moment.' });

  return NextResponse.json({ mode: 'pending', summary: 'Sprigly is writing this…', jobId: r.jobId });
}
