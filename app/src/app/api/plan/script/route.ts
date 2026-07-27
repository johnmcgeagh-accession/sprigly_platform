/**
 * POST /api/plan/script — enqueue combined hook+script generation for one reel. The job
 * writes the hook AND the script as one coherent pair, so it needs only a caption (the
 * subject), not a pre-existing hook. Reel-only (422 otherwise). Body: { targetPostId,
 * lengthSeconds }. Returns { mode: 'pending', jobId }; the client polls /api/jobs/:id.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueScriptJob } from '@/lib/queue';
import { loadPlanPosts } from '@/lib/plan';
import { gatePostEdit, editScopeToday } from '@/lib/edit-scope';

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

  // DATE POLICY: gate by the post's date + resolve its real cycle for the worker.
  const gate = await gatePostEdit(session.clientId, targetPostId, editScopeToday());
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const cycleId = gate.cycleId;

  const posts = await loadPlanPosts(session.clientId, cycleId);
  const post = posts.find((p) => p.id === targetPostId);
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (post.format !== 'reel') return NextResponse.json({ error: 'format_unsupported' }, { status: 422 });
  // The combined job writes the hook itself; only the caption (the subject) is required.
  if (!post.caption) return NextResponse.json({ error: 'caption_required' }, { status: 422 });

  const r = await enqueueScriptJob({ type: 'script', clientId: session.clientId, cycleId, targetPostId, lengthSeconds });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'Already writing a script for this post. One moment.' });
  return NextResponse.json({ mode: 'pending', jobId: r.jobId });
}
