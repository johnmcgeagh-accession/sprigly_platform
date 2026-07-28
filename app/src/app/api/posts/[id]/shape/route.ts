/**
 * POST /api/posts/:id/shape — instructed refine of a post FIELD (post scope). `target`
 * selects the field: 'caption' (default) rewrites the caption via the full on-brand regen;
 * 'hook' / 'script' run the lighter minimal-edit refine (§26). Enqueues a `shape` job (the
 * worker dispatches hook/script to the refine path). Returns the pending branch:
 * { mode:'pending', summary, jobId }. Session-scoped.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueShape } from '@/lib/queue';
import { loadPlanPosts } from '@/lib/plan';
import { getUsageForCycle, isRewriteBlocked } from '@/lib/usage';
import { gatePostEdit, editScopeToday } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let instruction = '';
  let target: 'caption' | 'hook' | 'script' = 'caption';
  try {
    const b = (await req.json()) as { instruction?: unknown; target?: unknown };
    instruction = String(b.instruction ?? '').trim();
    if (b.target === 'hook' || b.target === 'script') target = b.target;
  } catch { /* below */ }
  if (!instruction) return NextResponse.json({ error: 'no_instruction' }, { status: 400 });

  // DATE POLICY: editable iff the post is dated today-onward, across any of the client's
  // cycles. Resolves the post's REAL cycle — the worker locates it by (id, cycleId, client).
  const today = editScopeToday();
  const gate = await gatePostEdit(session.clientId, params.id, today);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const cycleId = gate.cycleId;

  // hook/script refine: the field must exist and apply to the format (defense-in-depth —
  // the editor only offers a target whose field exists).
  if (target !== 'caption') {
    const post = (await loadPlanPosts(session.clientId, cycleId)).find((p) => p.id === params.id);
    if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const formatOk = target === 'hook' ? (post.format === 'reel' || post.format === 'carousel') : post.format === 'reel';
    if (!formatOk) return NextResponse.json({ error: 'format_unsupported' }, { status: 422 });
    const fieldText = target === 'hook' ? post.hook : post.script;
    if (!fieldText || !fieldText.trim()) {
      return NextResponse.json({ mode: 'empty', target, summary: `There’s no ${target} on this post yet. Generate one first, then refine it.` });
    }
  }

  // A refine/rewrite is AI work — enforce the monthly limit before any spend (per the
  // post's own cycle, so the quota follows the month being edited).
  const usage = await getUsageForCycle(session.clientId, cycleId);
  if (isRewriteBlocked(usage)) {
    return NextResponse.json({
      mode: 'blocked',
      summary: `You’ve used all ${usage.limit} AI changes this month. Resets on the 1st. Editing directly stays free.`,
      usage,
    });
  }

  const r = await enqueueShape({
    type: 'shape', scope: 'post', clientId: session.clientId, cycleId, targetPostId: params.id, instruction, target, source: 'web',
    // A session reached this route, so the client asked for it in as many words (0090).
    actor: 'client',
  });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'Still working on the last change to this post. One moment.' });

  return NextResponse.json({ mode: 'pending', summary: target === 'caption' ? 'Sprigly is rewriting this…' : `Sprigly is refining the ${target}…`, jobId: r.jobId });
}
