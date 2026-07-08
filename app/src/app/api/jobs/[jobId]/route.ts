/**
 * GET /api/jobs/:jobId — poll a shape job. On done, re-read the session's posts
 * from the DB and return them so the client swaps in the fresh set. Scoped: the
 * jobId must belong to the session's cycle (the id embeds the cycleId).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { readShapeJob, readHookJob } from '@/lib/queue';
import { loadPlanPosts } from '@/lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  // The jobId embeds the cycle (`<type>_<cycleId>_<postId>`) — only allow polling jobs
  // for this session's cycle.
  // Hook jobs return candidates (not a post write) — dispatch on the id prefix.
  if (params.jobId.startsWith(`hook_${session.cycleId}_`)) {
    const hook = await readHookJob(params.jobId);
    if (hook.status === 'done')  return NextResponse.json({ status: 'done', candidates: hook.candidates });
    if (hook.status === 'error') return NextResponse.json({ status: 'error', summary: hook.summary });
    if (hook.status === 'gone')  return NextResponse.json({ status: 'gone' });
    return NextResponse.json({ status: 'pending' });
  }

  if (!params.jobId.startsWith(`shape_${session.cycleId}_`)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const job = await readShapeJob(params.jobId);
  if (job.status === 'done') {
    const posts = await loadPlanPosts(session.clientId, session.cycleId);
    return NextResponse.json({ status: 'done', posts, changedPostIds: job.changedPostIds, summary: job.summary });
  }
  if (job.status === 'error') return NextResponse.json({ status: 'error', summary: job.summary });
  if (job.status === 'gone')  return NextResponse.json({ status: 'gone' });
  return NextResponse.json({ status: 'pending' });
}
