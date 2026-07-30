/**
 * POST /api/plan/hooks — enqueue hook generation for one reel/carousel post.
 *
 * ── A REEL NEVER TAKES THE SOLO HOOK PATH (C4) ───────────────────────────────────────
 *
 * A reel's hook and script are ONE coherent pair, written by one model call from the caption
 * (`script.ts`, commit 73bf1f7 — "the split this replaces welded a mismatched hook onto a
 * reel"). The fan-out has honoured that since `phase2.ts` (HOOK_FORMATS = carousel only), and
 * so has the F5 add path. This route did not: the detail sheet's HOOK tab offered "Write the
 * hook", which came here, which enqueued the standalone `hook.ts` job — so a reel could be
 * given a hook that a later script had never seen, and the operator's video is the two
 * disagreeing.
 *
 * So a reel is REDIRECTED to the combined job here rather than refused: the client asked for a
 * hook and gets one, written together with the script it has to cohere with. The response says
 * `combined: true` and hands back a `script_…` jobId, which the poller already routes by prefix
 * — the combined job writes both fields onto the post instead of returning candidates to pick.
 *
 * CAPTION ABSENT → REFUSED, not generated. Both fields are built FROM the caption; there is no
 * machinery here that writes one first, and generating from the draft placeholder is what put a
 * hook and a script about our own scaffolding sentence on a fresh reel. `caption_required` is
 * the same 422 the script route returns, and the sheet already renders that refusal as the
 * sentence "the hook and the script are built around the caption, so that has to come first".
 *
 * Carousels are unchanged: they have no script to cohere with, so the standalone hook (with its
 * three candidates for the client to pick from) is still right for them.
 */
import { NextResponse } from 'next/server';
import { hasRealCaption } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { enqueueHookJob, enqueueScriptJob } from '@/lib/queue';
import { loadPlanPosts } from '@/lib/plan';
import { gatePostEdit, editScopeToday } from '@/lib/edit-scope';

/** Matches the interactive default (PostEditor) and script-ready.ts's fan-out default. */
const DEFAULT_SCRIPT_SECONDS = 30;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let targetPostId = '';
  try { targetPostId = String(((await req.json()) as { targetPostId?: unknown }).targetPostId ?? ''); } catch { /* below */ }
  if (!targetPostId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // DATE POLICY: gate by the post's date + resolve its real cycle for the worker.
  const gate = await gatePostEdit(session.clientId, targetPostId, editScopeToday());
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const cycleId = gate.cycleId;

  const posts = await loadPlanPosts(session.clientId, cycleId);
  const post = posts.find((p) => p.id === targetPostId);
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (post.format !== 'reel' && post.format !== 'carousel') {
    return NextResponse.json({ error: 'format_unsupported' }, { status: 422 });
  }

  // A REEL takes the combined hook+script job — see the header. One entry point, one job, one
  // Bedrock sequence, and a hook that cannot disagree with the script it shipped with.
  if (post.format === 'reel') {
    if (!hasRealCaption(post.caption)) return NextResponse.json({ error: 'caption_required' }, { status: 422 });
    const combined = await enqueueScriptJob({
      type: 'script', clientId: session.clientId, cycleId, targetPostId,
      lengthSeconds: post.scriptLengthSeconds ?? DEFAULT_SCRIPT_SECONDS,
    });
    if ('error' in combined) return NextResponse.json({ error: combined.error }, { status: 503 });
    if ('busy' in combined) return NextResponse.json({ mode: 'noop', summary: 'Already writing this reel’s hook and script. One moment.' });
    return NextResponse.json({ mode: 'pending', jobId: combined.jobId, combined: true });
  }

  const r = await enqueueHookJob({ type: 'hook', clientId: session.clientId, cycleId, targetPostId });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'Already generating hooks for this post. One moment.' });
  return NextResponse.json({ mode: 'pending', jobId: r.jobId });
}
