/**
 * POST /api/plan/hooks — enqueue hook generation for one reel/carousel post. Returns
 * { mode: 'pending', jobId }; the client polls /api/jobs/:id for the 3 candidates. Hooks
 * are reels + carousels only (422 otherwise). Scoped to the session's editable cycle.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueHookJob } from '@/lib/queue';
import { loadPlanPosts } from '@/lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let targetPostId = '';
  try { targetPostId = String(((await req.json()) as { targetPostId?: unknown }).targetPostId ?? ''); } catch { /* below */ }
  if (!targetPostId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const posts = await loadPlanPosts(session.clientId, session.cycleId);
  const post = posts.find((p) => p.id === targetPostId);
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (post.format !== 'reel' && post.format !== 'carousel') {
    return NextResponse.json({ error: 'format_unsupported' }, { status: 422 });
  }

  const r = await enqueueHookJob({ type: 'hook', clientId: session.clientId, cycleId: session.cycleId, targetPostId });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'Already generating hooks for this post — one moment.' });
  return NextResponse.json({ mode: 'pending', jobId: r.jobId });
}
