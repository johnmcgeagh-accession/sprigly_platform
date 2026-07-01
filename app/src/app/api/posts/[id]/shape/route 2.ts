/**
 * POST /api/posts/:id/shape — instructed caption rewrite (post scope). Enqueues a
 * `shape` job; the worker does the on-brand Bedrock regen. Returns the pending
 * branch of the applyShape seam: { mode:'pending', summary, jobId }. Session-scoped.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueShape } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let instruction = '';
  try { instruction = String(((await req.json()) as { instruction?: unknown }).instruction ?? '').trim(); } catch { /* below */ }
  if (!instruction) return NextResponse.json({ error: 'no_instruction' }, { status: 400 });

  const r = await enqueueShape({
    type: 'shape', scope: 'post', cycleId: session.cycleId, targetPostId: params.id, instruction, source: 'web',
  });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });

  return NextResponse.json({ mode: 'pending', summary: 'Sprigly is rewriting this…', jobId: r.jobId });
}
