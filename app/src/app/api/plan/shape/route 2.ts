/**
 * POST /api/plan/shape — plan-scope shaping. The main case is writing the caption
 * for a draft the app already created structurally (Phase 2 "add a post about X").
 * Body: { targetPostId, instruction }. Enqueues a `shape` job; returns pending.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueShape } from '@/lib/queue';

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

  const r = await enqueueShape({
    type: 'shape', scope: 'plan', cycleId: session.cycleId, targetPostId, instruction, source: 'web',
  });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });

  return NextResponse.json({ mode: 'pending', summary: 'Sprigly is writing this…', jobId: r.jobId });
}
