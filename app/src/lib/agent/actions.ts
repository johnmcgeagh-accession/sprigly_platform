/**
 * agent/actions.ts — run an action plan (structural / add / rewrite) through the
 * EXISTING mutation + shape-job pipeline. This is the commit-1 route body factored
 * out so the proposal-agent route can reuse it verbatim: same quota gate, same
 * busy handling, same free-vs-counted split. No behaviour change.
 */
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { patchPost, softDeletePost, addDraft } from '../mutations';
import { enqueueShape } from '../queue';
import { getUsageForCycle, isRewriteBlocked } from '../usage';
import type { AgentPlan } from '../agent-classify';
import type { ShapeResult } from '../types';

export interface ActionOutcome {
  text: string;
  applied?: { changedPostIds: string[] };
  pendingJobIds?: string[];
  error?: string;
}

/** Apply a structural/add/rewrite plan. Mirrors the pre-rebuild route exactly. */
export async function runActionPlan(plan: AgentPlan, clientId: string, cycleId: string): Promise<ActionOutcome> {
  // Structural — synchronous, free, never counted.
  if (plan.kind === 'structural') {
    const changed: string[] = [];
    for (const a of plan.actions) {
      const r: ShapeResult | null = a.type === 'delete'
        ? await softDeletePost(clientId, cycleId, a.postId)
        : await patchPost(clientId, cycleId, a.postId, a.patch);
      if (r && r.mode === 'applied') changed.push(...r.changedPostIds);
    }
    return { text: plan.summary, applied: { changedPostIds: changed } };
  }

  // AI work below → enforce the monthly limit before any spend.
  const usage = await getUsageForCycle(clientId, cycleId);
  if (isRewriteBlocked(usage)) {
    return { text: `You’ve used all ${usage.limit} AI changes this month — resets on the 1st. Moving, reformatting, adding and removing posts stays free.` };
  }

  if (plan.kind === 'add') {
    const [cyc] = await db
      .select({ channel: contentCycles.channel })
      .from(contentCycles)
      .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
      .limit(1);
    const created = await addDraft(clientId, cycleId, cyc?.channel ?? 'instagram', plan.date);
    if (created.mode !== 'applied') return { text: 'Could not add the post.' };
    const newId = created.changedPostIds[0];
    if (!plan.caption || !newId) {
      return { text: plan.summary, applied: { changedPostIds: created.changedPostIds } };
    }
    const r = await enqueueShape({ type: 'shape', scope: 'plan', clientId, cycleId, targetPostId: newId, instruction: plan.caption, source: 'web' });
    if ('error' in r) return { text: 'Background jobs are unavailable right now — the draft was added, but I couldn’t write its caption.', applied: { changedPostIds: created.changedPostIds }, error: r.error };
    return { text: plan.summary, applied: { changedPostIds: created.changedPostIds }, pendingJobIds: [r.jobId] };
  }

  if (plan.kind === 'rewrite') {
    const jobIds: string[] = [];
    let busy = 0;
    for (const postId of plan.targetPostIds) {
      const r = await enqueueShape({ type: 'shape', scope: 'post', clientId, cycleId, targetPostId: postId, instruction: plan.instruction, source: 'web' });
      if ('error' in r) return { text: 'Background jobs are unavailable right now — please try again shortly.', error: r.error };
      if ('busy' in r) { busy++; continue; }
      jobIds.push(r.jobId);
    }
    if (jobIds.length === 0) {
      return { text: busy > 0 ? 'Still finishing the last change on that post — give it a moment, then try again.' : 'Nothing to rewrite.' };
    }
    return { text: busy > 0 ? `${plan.summary} (${busy} still finishing a previous change)` : plan.summary, pendingJobIds: jobIds };
  }

  return { text: 'Nothing to change.' };
}
