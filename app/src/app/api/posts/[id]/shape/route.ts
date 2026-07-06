/**
 * POST /api/posts/:id/shape — instructed caption rewrite (post scope). Enqueues a
 * `shape` job; the worker does the on-brand Bedrock regen. Returns the pending
 * branch of the applyShape seam: { mode:'pending', summary, jobId }. Session-scoped.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueShape } from '@/lib/queue';
import { getUsageForCycle, isRewriteBlocked } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let instruction = '';
  try { instruction = String(((await req.json()) as { instruction?: unknown }).instruction ?? '').trim(); } catch { /* below */ }
  if (!instruction) return NextResponse.json({ error: 'no_instruction' }, { status: 400 });

  // A rewrite is AI work — enforce the monthly limit before any spend.
  const usage = await getUsageForCycle(session.clientId, session.cycleId);
  if (isRewriteBlocked(usage)) {
    return NextResponse.json({
      mode: 'blocked',
      summary: `You’ve used all ${usage.limit} AI changes this month — resets on the 1st. Editing directly stays free.`,
      usage,
    });
  }

  const r = await enqueueShape({
    type: 'shape', scope: 'post', clientId: session.clientId, cycleId: session.cycleId, targetPostId: params.id, instruction, source: 'web',
  });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'Still working on the last change to this post — one moment.' });

  return NextResponse.json({ mode: 'pending', summary: 'Sprigly is rewriting this…', jobId: r.jobId });
}
