/**
 * script.ts — Stage 6 reel script generation. Given a post's hook + caption + pillar and
 * a target length, produces a structured script (hook line, timed beats + shot notes, CTA)
 * and writes it to the post's `script` column so it lands on the next plan refresh.
 *
 * Reuses `assembleShapeContext` for voice context (as-is, client/cycle-scoped). Emits a
 * `script_saved` plan_activity row (origin=agent) from day one — deviation-3, alongside the
 * shape worker's caption_saved. The subsequent user edit + Save re-ledgers script_saved/user.
 */
import { and, eq } from 'drizzle-orm';
import { contentCycles, contentCyclePosts } from '@sprigly/db';
import { assembleShapeContext } from './planning.js';
import type { PlanningDeps } from './planning.js';
import { recordPlanActivity } from './ledger.js';

const SCRIPT_WORKFLOW = 'plan_scripts';
const SCRIPT_STEP     = 'generate';
const SCRIPT_MODEL    = 'sonnet';
const WORDS_PER_SECOND = 2.2;   // spoken-word budget guidance

export interface ScriptJob {
  type:          'script';
  clientId:      string;
  cycleId:       string;
  targetPostId:  string;
  lengthSeconds: number;   // 15 | 30 | 60 | 90
}
export interface ScriptResultData { changedPostIds: string[]; summary: string; }

export async function runScriptForPost(job: ScriptJob, deps: PlanningDeps): Promise<ScriptResultData> {
  const { db, model, prompts, logger } = deps;
  const logCtx = { cycleId: job.cycleId, postId: job.targetPostId, len: job.lengthSeconds };

  const [cycle] = await db.select().from(contentCycles).where(eq(contentCycles.id, job.cycleId)).limit(1);
  if (!cycle) throw new Error(`script: cycle ${job.cycleId} not found`);
  if (cycle.clientId !== job.clientId) throw new Error(`script: cycle ${job.cycleId} not owned by client ${job.clientId}`);

  const [post] = await db.select().from(contentCyclePosts).where(and(
    eq(contentCyclePosts.id, job.targetPostId),
    eq(contentCyclePosts.cycleId, job.cycleId),
    eq(contentCyclePosts.clientId, job.clientId),
  )).limit(1);
  if (!post) throw new Error(`script: post ${job.targetPostId} not found`);
  if (post.format !== 'reel') throw new Error(`script: format ${post.format} does not support scripts`);
  if (!post.hook || !post.caption) throw new Error('script: hook and caption are required');

  const ctx = await assembleShapeContext(cycle, deps);
  const targetWords = Math.round(job.lengthSeconds * WORDS_PER_SECOND);

  const system = await prompts.resolve(job.clientId, SCRIPT_WORKFLOW, SCRIPT_STEP);
  const user = [
    ctx.voiceMd ? `CLIENT VOICE (voice.md):\n${ctx.voiceMd}` : 'CLIENT VOICE: (unavailable — keep it plain and on-brand).',
    `PILLAR: ${post.pillar ?? '(none)'}`,
    `HOOK (use verbatim as the opening line):\n${post.hook}`,
    `CAPTION / IDEA:\n${post.caption}`,
    `TARGET LENGTH: ${job.lengthSeconds}s (~${targetWords} spoken words at ${WORDS_PER_SECOND} words/second — keep the whole script within that budget).`,
  ].join('\n\n');

  const res = await model.complete({ model: SCRIPT_MODEL, system, messages: [{ role: 'user', content: user }], maxTokens: 1200, temperature: 0.6 });

  // ── AUDIT: this call is on the cost-guard's ledger ─────────────────────────
  // It was NOT, until Build D — hook and script spend was invisible to phase2-cost.ts,
  // which reads audit_log on the assumption that every call site writes to it. Two did
  // not. The structural cure is a Bedrock wrapper that writes the audit entry itself, so
  // the assumption is true by construction rather than by everyone remembering.
  //
  // NOT DONE, deliberately: the hardening enumeration found 31 invocation sites across 6
  // packages, many with no clientId in scope at all (CLIs, probes, the eval harness,
  // workflow steps). Wrapping them is a real piece of work, not a hardening tweak.
  // Backlogged with the full site list in docs/reports/hardening-pre-uat.md §4.
  // Until then: ANY new model call needs its own audit write, like this one.
  try {
    await deps.audit.logModelCall({
      clientId: job.clientId, modelId: res.modelId, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      action: 'content-cycle:script', metadata: { cycleId: job.cycleId, postId: job.targetPostId, lengthSeconds: job.lengthSeconds },
    });
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'script: audit log failed — non-fatal');
  }
  const scriptText = res.content.trim();
  if (!scriptText) throw new Error('script: model returned an empty script');

  await db.update(contentCyclePosts)
    .set({ script: scriptText, scriptLengthSeconds: job.lengthSeconds })
    .where(and(eq(contentCyclePosts.id, post.id), eq(contentCyclePosts.cycleId, job.cycleId), eq(contentCyclePosts.clientId, job.clientId)));

  // Ledger (deviation-3): agent-authored script.
  try {
    await recordPlanActivity(db, {
      clientId: cycle.clientId, cycleId: job.cycleId, postId: post.id,
      action: 'script_saved', actor: { origin: 'agent' }, payload: { lengthSeconds: job.lengthSeconds },
    });
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'script: plan_activity ledger write failed — non-fatal');
  }

  logger.info({ ...logCtx }, 'script: generated and written');
  return { changedPostIds: [post.id], summary: 'Wrote your reel script.' };
}
