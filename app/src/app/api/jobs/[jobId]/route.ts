/**
 * GET /api/jobs/:jobId — poll a shape / hook / script job. The jobId embeds the cycle it
 * was enqueued for (`<type>_<cycleId>_<postId>`). Enqueue resolves the TARGET POST's real
 * cycle (gatePostEdit), which for a cross-month or non-home post is NOT the session's home
 * cycle — so authorisation is by the session CLIENT owning the job's cycle, never by
 * session.cycleId equality (that anchor made every non-home job 403 → the client polled
 * forever). On 'done', shape/script re-read THAT cycle's posts so the client swaps in the
 * fresh set.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { readShapeJob, readHookJob, readScriptJob } from '@/lib/queue';
import { loadPlanPosts } from '@/lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  // Parse `<type>_<cycleId>_<postId>` — cycleId/postId are UUIDs (no underscores).
  const [jobType, jobCycleId] = params.jobId.split('_');
  if ((jobType !== 'hook' && jobType !== 'shape' && jobType !== 'script') || !jobCycleId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Authorise by CLIENT ownership of the job's cycle — any of the client's cycles, not
  // just the token's home. A forged / other-client cycle never resolves → 403, never leaks.
  const [owned] = await db
    .select({ id: contentCycles.id })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, jobCycleId), eq(contentCycles.clientId, session.clientId)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Hook jobs return candidates (not a post write).
  if (jobType === 'hook') {
    const hook = await readHookJob(params.jobId);
    if (hook.status === 'done')  return NextResponse.json({ status: 'done', candidates: hook.candidates });
    if (hook.status === 'error') return NextResponse.json({ status: 'error', summary: hook.summary });
    if (hook.status === 'gone')  return NextResponse.json({ status: 'gone' });
    return NextResponse.json({ status: 'pending' });
  }

  // Shape + script write onto the post, so 'done' re-reads the JOB'S cycle (not home).
  const job = jobType === 'script' ? await readScriptJob(params.jobId) : await readShapeJob(params.jobId);
  if (job.status === 'done') {
    const posts = await loadPlanPosts(session.clientId, jobCycleId);
    return NextResponse.json({ status: 'done', posts, changedPostIds: job.changedPostIds, summary: job.summary });
  }
  if (job.status === 'error') return NextResponse.json({ status: 'error', summary: job.summary });
  if (job.status === 'gone')  return NextResponse.json({ status: 'gone' });
  return NextResponse.json({ status: 'pending' });
}
