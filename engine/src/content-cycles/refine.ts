/**
 * refine.ts — target-aware refine of a post's HOOK or SCRIPT (§26). The CAPTION path
 * stays in shape.ts (the full generate+validate machinery); hooks and scripts get a
 * lighter, minimal-edit refine that reuses the shape job's plumbing: it runs as the same
 * 'shape' BullMQ job (same deterministic jobId, same GET /api/jobs poll → plan reload),
 * dispatched here by the consumer when `job.target` is 'hook' or 'script'.
 *
 * Inputs are the CURRENT field text + the instruction + assembleShapeContext voice
 * context, plus (script) the hook, length and words-per-second budget so a refined script
 * stays timed, and (hook) the pattern is kept to one line so it can't drift into a caption.
 * The prompt instructs a minimal-necessary edit, not a rewrite-from-scratch. Output writes
 * the field via the same pending → arrives → autosave flow, ledgered hook_saved /
 * script_saved (origin agent) and counted against the AI cap via a post_edits row.
 */
import { and, eq } from 'drizzle-orm';
import { contentCycles, contentCyclePosts, postEdits } from '@sprigly/db';
import { assembleShapeContext } from './planning.js';
import type { PlanningDeps } from './planning.js';
import { recordPlanActivity } from './ledger.js';
import type { ShapeJob, ShapeResultData } from './shape.js';

const MODEL = 'sonnet';
const WORDS_PER_SECOND = 2.2;

/** First non-empty line, surrounding quotes stripped — a refined hook must stay one line. */
function oneLine(s: string): string {
  const line = s.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? s.trim();
  return line.replace(/^["“']+|["”']+$/g, '').trim();
}

/** Refine a post's hook or script to an instruction. Same job/return shape as shape.ts so
 *  the poll → reload → autosave flow is identical. Throws (job → error) on an empty field
 *  or empty model output; the route guards the empty-field case before enqueue. */
export async function runFieldRefine(job: ShapeJob, deps: PlanningDeps): Promise<ShapeResultData> {
  const target = job.target === 'script' ? 'script' : 'hook';   // caption never reaches here
  const { db, model, prompts, logger } = deps;
  const logCtx = { cycleId: job.cycleId, postId: job.targetPostId, target };

  const [cycle] = await db.select().from(contentCycles).where(eq(contentCycles.id, job.cycleId)).limit(1);
  if (!cycle) throw new Error(`refine: cycle ${job.cycleId} not found`);
  if (cycle.clientId !== job.clientId) throw new Error(`refine: cycle ${job.cycleId} not owned by client ${job.clientId}`);

  const [post] = await db.select().from(contentCyclePosts).where(and(
    eq(contentCyclePosts.id, job.targetPostId),
    eq(contentCyclePosts.cycleId, job.cycleId),
    eq(contentCyclePosts.clientId, job.clientId),
  )).limit(1);
  if (!post) throw new Error(`refine: post ${job.targetPostId} not found`);

  if (target === 'hook') {
    if (post.format !== 'reel' && post.format !== 'carousel') throw new Error('refine: hooks apply to reels and carousels');
    if (!post.hook) throw new Error('refine: there is no hook to refine yet');
  } else {
    if (post.format !== 'reel') throw new Error('refine: scripts apply to reels');
    if (!post.script) throw new Error('refine: there is no script to refine yet');
  }

  const ctx = await assembleShapeContext(cycle, deps);
  const workflow = target === 'hook' ? 'plan_hooks' : 'plan_scripts';
  const system = await prompts.resolve(job.clientId, workflow, 'refine');

  const before = (target === 'hook' ? post.hook : post.script) ?? '';
  const voiceLine = ctx.voiceMd
    ? `CLIENT VOICE (voice.md):\n${ctx.voiceMd}`
    : 'CLIENT VOICE: (unavailable — keep it plain and on-brand).';
  const len = post.scriptLengthSeconds ?? 30;
  const userParts = target === 'hook'
    ? [
        voiceLine,
        `PILLAR: ${post.pillar ?? '(none)'}`,
        `CAPTION (context only — do NOT turn the hook into the caption):\n${post.caption ?? '(none)'}`,
        `CURRENT HOOK:\n${before}`,
        `INSTRUCTION: ${job.instruction.trim()}`,
        `Refine the hook to satisfy the instruction with the lightest touch. Return ONLY the one-line hook.`,
      ]
    : [
        voiceLine,
        `PILLAR: ${post.pillar ?? '(none)'}`,
        `HOOK (keep it as the opening line):\n${post.hook ?? '(none)'}`,
        `CAPTION (context):\n${post.caption ?? '(none)'}`,
        `TARGET LENGTH: ${len}s (~${Math.round(len * WORDS_PER_SECOND)} spoken words at ${WORDS_PER_SECOND} words/second — keep within that budget).`,
        `CURRENT SCRIPT:\n${before}`,
        `INSTRUCTION: ${job.instruction.trim()}`,
        `Refine the script to satisfy the instruction with the lightest touch, keeping it timed.`,
      ];

  const res = await model.complete({
    model: MODEL, system, messages: [{ role: 'user', content: userParts.join('\n\n') }],
    maxTokens: target === 'hook' ? 300 : 1200, temperature: 0.5,
  });
  const after = target === 'hook' ? oneLine(res.content) : res.content.trim();
  if (!after) throw new Error(`refine: model returned an empty ${target}`);

  const status = post.status === 'new' ? 'new' : 'edited';
  await db.update(contentCyclePosts)
    .set(target === 'hook' ? { hook: after, status } : { script: after, status })
    .where(and(eq(contentCyclePosts.id, post.id), eq(contentCyclePosts.cycleId, job.cycleId), eq(contentCyclePosts.clientId, job.clientId)));

  // A refine is AI work — record a post_edits row so it counts against the AI cap like a
  // caption shape (the caption columns carry the field's before/after text).
  try {
    await db.insert(postEdits).values({
      postId: post.id, cycleId: job.cycleId, scope: job.scope,
      instruction: job.instruction, captionBefore: before, captionAfter: after, passed: true,
      actor: job.actor ?? 'agent',
    });
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'refine: post_edits audit write failed — non-fatal');
  }

  try {
    await recordPlanActivity(db, {
      clientId: cycle.clientId, cycleId: job.cycleId, postId: post.id,
      action: target === 'hook' ? 'hook_saved' : 'script_saved',
      actor: { origin: 'agent', actor: job.actor ?? 'agent', refProposalId: job.proposalId ?? null },
    });
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'refine: plan_activity ledger write failed — non-fatal');
  }

  logger.info({ ...logCtx }, `refine: ${target} refined`);
  return { changedPostIds: [post.id], summary: target === 'hook' ? 'Refined the hook.' : 'Refined the script.' };
}
