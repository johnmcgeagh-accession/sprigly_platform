/**
 * POST /api/plan/agent — the plan-level agent bar. Takes a free-text instruction,
 * classifies it (deterministic, no model), and routes:
 *   structural (move/format/add-blank/remove) → apply via Phase 2 mutations,
 *     synchronous + FREE + uncounted → { mode:'applied', posts, ... }.
 *   rewrite / "add a post about X"            → enqueue the Phase 3 shape job(s),
 *     COUNTED against the monthly AI-change limit → { mode:'pending', jobIds, usage }.
 *   at/over limit (no override)               → { mode:'blocked' } — no enqueue, no spend.
 *   unclear                                   → { mode:'noop' } — a gentle nudge.
 * Everything is scoped server-side to the session's (clientId, cycleId).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { loadPlanPosts } from '@/lib/plan';
import { classifyAgentInstruction } from '@/lib/agent-classify';
import { patchPost, softDeletePost, addDraft } from '@/lib/mutations';
import { enqueueShape } from '@/lib/queue';
import { getUsageForCycle, isRewriteBlocked } from '@/lib/usage';
import type { ShapeResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { clientId, cycleId } = session;

  let instruction = '', selectedPostId: string | undefined;
  try {
    const b = (await req.json()) as { instruction?: unknown; selectedPostId?: unknown };
    instruction = String(b.instruction ?? '').trim();
    if (b.selectedPostId) selectedPostId = String(b.selectedPostId);
  } catch { /* below */ }
  if (!instruction) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const posts = await loadPlanPosts(clientId, cycleId);
  const plan  = classifyAgentInstruction(instruction, posts, selectedPostId);

  // Gentle clarification — nothing applied, nothing spent.
  if (plan.kind === 'clarify') {
    return NextResponse.json({ mode: 'noop', summary: plan.summary });
  }

  // Structural — synchronous, free, never counted.
  if (plan.kind === 'structural') {
    let lastPosts = posts;
    const changed: string[] = [];
    for (const a of plan.actions) {
      const r: ShapeResult | null = a.type === 'delete'
        ? await softDeletePost(clientId, cycleId, a.postId)
        : await patchPost(clientId, cycleId, a.postId, a.patch);
      if (r && r.mode === 'applied') { lastPosts = r.posts; changed.push(...r.changedPostIds); }
    }
    return NextResponse.json({ mode: 'applied', summary: plan.summary, changedPostIds: changed, posts: lastPosts });
  }

  // Everything below is AI work → enforce the monthly limit before any spend.
  const usage = await getUsageForCycle(clientId, cycleId);
  if (isRewriteBlocked(usage)) {
    return NextResponse.json({
      mode: 'blocked',
      summary: `You’ve used all ${usage.limit} AI changes this month — resets on the 1st. Moving, reformatting, adding and removing posts stays free.`,
      usage,
    });
  }

  // "add a post about X" — create the blank draft structurally (free), then write its
  // caption with one shape job (counted). A plain "add a post" stays fully structural.
  if (plan.kind === 'add') {
    const [cyc] = await db
      .select({ channel: contentCycles.channel })
      .from(contentCycles)
      .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
      .limit(1);
    const created = await addDraft(clientId, cycleId, cyc?.channel ?? 'instagram', plan.date);
    if (created.mode !== 'applied') return NextResponse.json({ mode: 'noop', summary: 'Could not add the post.' });
    const newId = created.changedPostIds[0];
    if (!plan.caption || !newId) {
      return NextResponse.json({ mode: 'applied', summary: plan.summary, changedPostIds: created.changedPostIds, posts: created.posts });
    }
    const r = await enqueueShape({ type: 'shape', scope: 'plan', cycleId, targetPostId: newId, instruction: plan.caption, source: 'web' });
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
    return NextResponse.json({ mode: 'pending', summary: plan.summary, jobIds: [r.jobId], usage });
  }

  // Rewrite — one validated shape job per target post (each counts when it lands).
  if (plan.kind === 'rewrite') {
    const jobIds: string[] = [];
    for (const postId of plan.targetPostIds) {
      const r = await enqueueShape({ type: 'shape', scope: 'post', cycleId, targetPostId: postId, instruction: plan.instruction, source: 'web' });
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
      jobIds.push(r.jobId);
    }
    return NextResponse.json({ mode: 'pending', summary: plan.summary, jobIds, usage });
  }

  return NextResponse.json({ mode: 'noop', summary: 'Nothing to change.' });
}
