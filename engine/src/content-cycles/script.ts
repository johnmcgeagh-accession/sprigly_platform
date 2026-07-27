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
import { extractDeliverable, hasDeliberativeMarkers } from './deliverable.js';

const SCRIPT_WORKFLOW = 'plan_scripts';
const SCRIPT_STEP     = 'generate';
const SCRIPT_MODEL    = 'sonnet';
const WORDS_PER_SECOND = 2.2;   // spoken-word budget guidance

/** The response contract, enforced at the call site (not the mutable DB prompt) so it cannot
 *  drift per client and needs no migration. The parser tolerates the model ignoring it. */
const SCRIPT_OUTPUT_CONTRACT =
  'OUTPUT CONTRACT: think first if you need to, then write the finished script AFTER a line that reads exactly ===SCRIPT===. ' +
  'Only the text after that marker is kept. Put NO reasoning, word counts, or register notes inside the script, and write nothing after it — everything before the marker is discarded.';

/** Sent on the one repair attempt when the first answer leaked its working notes. */
const SCRIPT_REPAIR_REMINDER =
  'Your previous answer let working notes into the script. Return ONLY the finished script after a line reading exactly ===SCRIPT===, with no word-count arithmetic, no "actually…"/"let me…" asides, and no commentary of any kind.';

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
    SCRIPT_OUTPUT_CONTRACT,
  ].join('\n\n');

  // ── AUDIT: every call is on the cost-guard's ledger ────────────────────────
  // hook and script spend was invisible to phase2-cost.ts until Build D — it reads audit_log
  // on the assumption that every call site writes to it, and two did not. The structural cure
  // is a Bedrock wrapper that writes the audit entry itself; until that lands (31 sites, many
  // with no clientId — docs/reports/hardening-pre-uat.md §4), ANY new model call needs its own
  // write. The repair call is a real Bedrock call, so it is audited too.
  const complete = async (content: string) => {
    const r = await model.complete({ model: SCRIPT_MODEL, system, messages: [{ role: 'user', content }], maxTokens: 1200, temperature: 0.6 });
    try {
      await deps.audit.logModelCall({
        clientId: job.clientId, modelId: r.modelId, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        action: 'content-cycle:script', metadata: { cycleId: job.cycleId, postId: job.targetPostId, lengthSeconds: job.lengthSeconds },
      });
    } catch (err) {
      logger.warn({ ...logCtx, err: String(err) }, 'script: audit log failed — non-fatal');
    }
    return r;
  };

  // Deliverables contain deliverables only. Keep the text after ===SCRIPT===, discard the
  // reasoning before it, and check what survives for leaked working notes. If reasoning bled
  // INTO the script, repair once with a stricter reminder; if it is still contaminated, FLAG
  // it (a loud failure) rather than store the transcript as the client's script.
  let res = await complete(user);
  let scriptText = extractDeliverable(res.content, 'SCRIPT');
  if (!scriptText) throw new Error('script: model returned an empty script');

  if (hasDeliberativeMarkers(scriptText)) {
    logger.warn({ ...logCtx }, 'script: working notes leaked into the deliverable — repairing once');
    res = await complete(`${user}\n\n${SCRIPT_REPAIR_REMINDER}`);
    scriptText = extractDeliverable(res.content, 'SCRIPT');
    if (!scriptText || hasDeliberativeMarkers(scriptText)) {
      // Never store contaminated output. Fail loudly instead: the script field stays empty
      // (regenerable from the surface) and the failure is visible in the job and the logs.
      throw new Error('script: the model kept leaking its reasoning into the script — withheld rather than stored');
    }
  }

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
