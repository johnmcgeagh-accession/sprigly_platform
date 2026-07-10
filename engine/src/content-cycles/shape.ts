/**
 * shape.ts — Phase 3 natural-language regen handler. Rewrites a single post's
 * caption from a client instruction ("make it softer"), reusing the EXACT planning
 * generate + validate machinery (assembleShapeContext → regeneratePost →
 * applyCodeGate → applyCritic → catalogue) so a reshaped caption stays on-brand and
 * passes the same gates as an originally-generated one.
 *
 * Writes ONLY the caption (+ status='edited'); structural fields are Phase 2's job.
 * Preserves source_meta.original so revert always returns to the generated baseline.
 * On unrecoverable validation failure it throws (job → error, post unchanged).
 */
import { and, eq } from 'drizzle-orm';
import { contentCycles, contentCyclePosts, postEdits } from '@sprigly/db';
import type { Catalogue } from '../catalogue/parse-catalogue.js';
import { indexCatalogue, applyCatalogueValidation, deriveBrandTokens } from '../catalogue/validate-catalogue.js';
import { assembleShapeContext } from './planning.js';
import type { PlanningDeps } from './planning.js';
import { recordPlanActivity } from './ledger.js';
import {
  regeneratePost, applyCodeGate, applyCritic,
  type PlanPostRow, type PlanRepairContext, type CriticContext, type RegisterMap,
} from './plan-validation.js';

const PLANNING_MODEL = 'sonnet';

export interface ShapeJob {
  type:         'shape';
  scope:        'post' | 'plan';
  clientId:     string;
  cycleId:      string;
  targetPostId: string;
  instruction:  string;
  source:       'web' | 'voice';
  proposalId?:  string;   // set when this rewrite applied an approved proposal (ledger ref)
  // Which field the instruction refines. Default (absent) = caption → this handler. hook /
  // script are dispatched to runFieldRefine (refine.ts) by the consumer (§26).
  target?:      'caption' | 'hook' | 'script';
}

export interface ShapeResultData { changedPostIds: string[]; summary: string; }

const FORMAT_LABEL: Record<string, string> = { reel: 'Reel', carousel: 'Carousel', single: 'Static', email: 'Email' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoToLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d ?? 1} ${MONTHS[(m ?? 1) - 1]}`;
}

/** Run an instructed caption rewrite for one post. Returns the changed-post ids for
 *  job.returnvalue; throws on a validation failure that couldn't be repaired. */
export async function runShapeForCycle(job: ShapeJob, deps: PlanningDeps): Promise<ShapeResultData> {
  const { db, logger } = deps;
  const logCtx = { cycleId: job.cycleId, postId: job.targetPostId, scope: job.scope };

  const [cycle] = await db.select().from(contentCycles).where(eq(contentCycles.id, job.cycleId)).limit(1);
  if (!cycle) throw new Error(`shape: cycle ${job.cycleId} not found`);
  // Defense-in-depth: the enqueuer derives clientId server-side from the
  // session; refuse if the job's client doesn't own the cycle.
  if (cycle.clientId !== job.clientId) throw new Error(`shape: cycle ${job.cycleId} not owned by client ${job.clientId}`);

  const [post] = await db
    .select()
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, job.targetPostId),
      eq(contentCyclePosts.cycleId, job.cycleId),
      eq(contentCyclePosts.clientId, job.clientId),
    ))
    .limit(1);
  if (!post) throw new Error(`shape: post ${job.targetPostId} not found in cycle ${job.cycleId}`);

  const ctx = await assembleShapeContext(cycle, deps);
  const sm  = (post.sourceMeta ?? {}) as Record<string, unknown>;

  // Reconstruct the PlanPostRow shape the generate/validate path expects.
  const planPost: PlanPostRow = {
    date:              isoToLabel(post.scheduledDate),
    day:               String(sm['day'] ?? ''),
    title:             String(sm['title'] ?? ''),
    category:          String(sm['category'] ?? ''),
    pillar:            post.pillar ?? '',
    format:            FORMAT_LABEL[post.format] ?? 'Static',
    postingTime:       String(sm['postingTime'] ?? ''),
    whoPosts:          String(sm['whoPosts'] ?? ''),
    competitorInsight: String(sm['competitorInsight'] ?? ''),
    draftCaption:      post.caption ?? '',
    notes:             String(sm['notes'] ?? ''),
    clientWritesOwn:   sm['clientWritesOwn'] === true,
  };

  const repairCtx: PlanRepairContext = {
    vocab: ctx.vocab, model: deps.model, modelName: PLANNING_MODEL, audit: deps.audit,
    systemPrompt: ctx.systemPrompt, userMessage: ctx.userMessage, clientId: cycle.clientId, logger, logMeta: logCtx,
  };
  const criticCtx: CriticContext = {
    criticPrompt: ctx.criticPrompt, voiceMd: ctx.voiceMd,
    planConfig: {
      pillars:     ctx.planConfigRow?.pillars ?? [],
      categories:  ctx.planConfigRow?.categories ?? [],
      registerMap: (ctx.planConfigRow?.registerMap ?? {}) as RegisterMap,
    },
    historicPosts: ctx.historicPosts, voiceEdits: ctx.voiceEdits,
    model: deps.model, modelName: PLANNING_MODEL, audit: deps.audit,
    clientId: cycle.clientId, logger, logMeta: logCtx, exampleCount: 4,
  };

  const before = post.caption ?? '';
  // A post inserted by an async add-post-with-instruction carries status
  // 'generating'; a direct rewrite of an existing post does not.
  const isGenerating = post.status === 'generating';

  try {
    // 1. Instructed rewrite — frame the client's instruction as the change to make.
    const feedback = `The client asked for this change: "${job.instruction.trim()}". Rewrite the caption to honour it while keeping the post on-brand for this client (voice, register, sign-off, products).`;
    let revised = await regeneratePost(planPost, feedback, repairCtx);

    // 2. Same validation loop planning uses (mechanical gate → voice/register critic).
    const gate = await applyCodeGate([revised], repairCtx);
    if (gate.acceptedWithWarning.length > 0) {
      throw new Error('Could not produce a clean caption for that change — left it unchanged.');
    }
    const critic = await applyCritic(gate.rows, criticCtx, repairCtx);
    if (critic.acceptedWithWarning.length > 0) {
      throw new Error('Could not get that change on-brand — left the caption as it was.');
    }
    revised = critic.rows[0] ?? revised;

    // 3. HARD catalogue grounding (rewrite invalid product/colourway pairings).
    let finalCaption = revised.draftCaption ?? before;
    if (ctx.catalogue) {
      const idx = indexCatalogue(ctx.catalogue as Catalogue, ctx.structuredBrief, deriveBrandTokens(ctx.clientName));
      finalCaption = applyCatalogueValidation(finalCaption, '', idx).caption;
    }

    // 4. Write caption + status, PRESERVING source_meta (incl. original baseline).
    //    A generated new post becomes a normal 'new' draft with content; a rewrite
    //    of an existing post stays 'edited'.
    await db.update(contentCyclePosts)
      .set({ caption: finalCaption, status: isGenerating ? 'new' : 'edited' })
      .where(and(
        eq(contentCyclePosts.id, post.id),
        eq(contentCyclePosts.cycleId, job.cycleId),
        eq(contentCyclePosts.clientId, job.clientId),
      ));

    // 5. Audit (best-effort; never fails the job).
    try {
      await db.insert(postEdits).values({
        postId: post.id, cycleId: job.cycleId, scope: job.scope,
        instruction: job.instruction, captionBefore: before, captionAfter: finalCaption, passed: true,
      });
    } catch (err) {
      logger.warn({ ...logCtx, err: String(err) }, 'shape: post_edits audit write failed — non-fatal');
    }

    // 5b. Plan-activity ledger (deviation-3): an agent-authored caption. origin=agent,
    //     ref_proposal_id set when this rewrite applied an approved proposal.
    try {
      await recordPlanActivity(db, {
        clientId: cycle.clientId, cycleId: job.cycleId, postId: post.id,
        action: 'caption_saved', actor: { origin: 'agent', refProposalId: job.proposalId ?? null },
      });
    } catch (err) {
      logger.warn({ ...logCtx, err: String(err) }, 'shape: plan_activity ledger write failed — non-fatal');
    }

    logger.info({ ...logCtx }, 'shape: caption reshaped and validated');
    return { changedPostIds: [post.id], summary: 'Updated the caption.' };
  } catch (err) {
    // A failed async generation must not linger as 'generating' or fall back to a
    // placeholder — surface an explicit failed state, instruction preserved.
    if (isGenerating) {
      await db.update(contentCyclePosts)
        .set({ status: 'generation_failed', sourceMeta: { ...sm, generationError: err instanceof Error ? err.message : String(err) } })
        .where(and(
          eq(contentCyclePosts.id, post.id),
          eq(contentCyclePosts.cycleId, job.cycleId),
          eq(contentCyclePosts.clientId, job.clientId),
        ));
    }
    throw err;
  }
}
