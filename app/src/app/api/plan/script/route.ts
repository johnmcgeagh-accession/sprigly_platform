/**
 * POST /api/plan/script — enqueue reel-script generation for one post. Requires the post
 * to have a hook + caption (422 otherwise) and be a reel (422). Body: { targetPostId,
 * lengthSeconds }. Returns { mode: 'pending', jobId }; the client polls /api/jobs/:id.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueScriptJob } from '@/lib/queue';
import { loadPlanPosts } from '@/lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LENGTHS = new Set([15, 30, 60, 90]);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let targetPostId = '', lengthSeconds = 0;
  try {
    const b = (await req.json()) as { targetPostId?: unknown; lengthSeconds?: unknown };
    targetPostId = String(b.targetPostId ?? '');
    lengthSeconds = Number(b.lengthSeconds ?? 0);
  } catch { /* below */ }
  if (!targetPostId || !LENGTHS.has(lengthSeconds)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const posts = await loadPlanPosts(session.clientId, session.cycleId);
  const post = posts.find((p) => p.id === targetPostId);
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (post.format !== 'reel') return NextResponse.json({ error: 'format_unsupported' }, { status: 422 });
  if (!post.hook || !post.caption) return NextResponse.json({ error: 'hook_required' }, { status: 422 });

  const r = await enqueueScriptJob({ type: 'script', clientId: session.clientId, cycleId: session.cycleId, targetPostId, lengthSeconds });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'Already writing a script for this post — one moment.' });
  return NextResponse.json({ mode: 'pending', jobId: r.jobId });
}
