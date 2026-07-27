/**
 * hook.ts — Stage 6 hook generation for one reel/carousel post. Returns 3 candidate
 * hooks (NOT written to the post — the app presents them; the user picks + saves).
 *
 * Reuses `assembleShapeContext` for the client's voice context (voice.md, vocab). That
 * loader is client/cycle-scoped, NOT post-scoped — no adaptation was needed: it supplies
 * the on-brand voice, and this handler passes the specific post's caption/pillar/format
 * alongside. Pattern selection reads active=true only and instructs the model to imitate
 * each pattern's STRUCTURE, never the example's content.
 */
import { and, eq } from 'drizzle-orm';
import { contentCycles, contentCyclePosts, hookPatterns } from '@sprigly/db';
import { recordPlanActivity } from './ledger.js';
import { assembleShapeContext } from './planning.js';
import type { PlanningDeps } from './planning.js';
import { hasDeliberativeMarkers } from './deliverable.js';

const HOOK_WORKFLOW = 'plan_hooks';
const HOOK_STEP     = 'generate';
const HOOK_MODEL    = 'sonnet';
const CANDIDATE_COUNT = 3;
const PATTERN_SAMPLE  = 6;   // patterns shown to the model per call

export interface HookJob {
  type:         'hook';
  clientId:     string;
  cycleId:      string;
  targetPostId: string;
  /**
   * FAN-OUT MODE. Additive, and off unless set.
   *
   * Interactively, this job's whole job is to OFFER: it returns candidates and a human
   * picks one. In the approval fan-out there is no human, so the candidates were generated,
   * billed and thrown away — every reel and carousel in an auto-generated month ended up
   * with a null hook, and because scripts are gated on a hook existing, no script was ever
   * enqueued either (docs/reports/wrong-month-generated.md §5b–5c).
   *
   * With this set the job additionally PERSISTS its top candidate. The return value is
   * unchanged, so the interactive path is byte-identical — the flag is carried on the job
   * payload rather than read from anything ambient, so the two callers cannot drift.
   */
  autoSelect?:  boolean;
}
export interface HookResultData { candidates: string[]; }

/** Format tag as stored in hook_patterns.formats. Hooks are reels + carousels only. */
const FORMAT_TAG: Record<string, string> = { reel: 'reel', carousel: 'carousel' };

/** Select the patterns to show the model.
 *  ── ANALYTICS-WEIGHTING SEAM ────────────────────────────────────────────────
 *  Selection is a uniform random sample among active + format-matching patterns.
 *  When per-pattern performance data exists, weight the pick HERE (e.g. Thompson
 *  sampling on hook→save/publish rates) — swap this function's body only. */
function selectPatterns<T>(all: T[], n: number, rnd: () => number): T[] {
  const pool = [...all];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

/** Parse the model output into hook strings — JSON `{"hooks":[…]}` first, else lines. */
function parseHooks(content: string): string[] {
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]) as { hooks?: unknown };
      if (Array.isArray(j.hooks)) return j.hooks.map((h) => String(h).trim()).filter(Boolean);
    }
  } catch { /* fall through to line parsing */ }
  return content
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').replace(/^["“]|["”]$/g, '').trim())
    .filter((l) => l.length > 0 && l.length < 200);
}

export async function runHookForPost(job: HookJob, deps: PlanningDeps): Promise<HookResultData> {
  const { db, model, prompts, logger } = deps;
  const logCtx = { cycleId: job.cycleId, postId: job.targetPostId };

  const [cycle] = await db.select().from(contentCycles).where(eq(contentCycles.id, job.cycleId)).limit(1);
  if (!cycle) throw new Error(`hook: cycle ${job.cycleId} not found`);
  if (cycle.clientId !== job.clientId) throw new Error(`hook: cycle ${job.cycleId} not owned by client ${job.clientId}`);

  const [post] = await db.select().from(contentCyclePosts).where(and(
    eq(contentCyclePosts.id, job.targetPostId),
    eq(contentCyclePosts.cycleId, job.cycleId),
    eq(contentCyclePosts.clientId, job.clientId),
  )).limit(1);
  if (!post) throw new Error(`hook: post ${job.targetPostId} not found`);
  const tag = FORMAT_TAG[post.format];
  if (!tag) throw new Error(`hook: format ${post.format} does not support hooks`);

  // Client voice context (reused as-is — client/cycle-scoped).
  const ctx = await assembleShapeContext(cycle, deps);

  // Active patterns matching this format; random sample (analytics seam above).
  const active = await db.select().from(hookPatterns).where(eq(hookPatterns.active, true));
  const matching = active.filter((p) => (p.formats ?? []).includes(tag));
  if (matching.length === 0) throw new Error(`hook: no active patterns for format ${tag}`);
  const chosen = selectPatterns(matching, PATTERN_SAMPLE, Math.random);

  const patternBlock = chosen
    .map((p, i) => `${i + 1}. [${p.category}] STRUCTURE: ${p.pattern}\n   (illustration only — imitate the STRUCTURE, never this content: "${p.example}")`)
    .join('\n');

  const system = await prompts.resolve(job.clientId, HOOK_WORKFLOW, HOOK_STEP);
  const user = [
    ctx.voiceMd ? `CLIENT VOICE (voice.md):\n${ctx.voiceMd}` : 'CLIENT VOICE: (unavailable — keep it plain and on-brand).',
    `POST FORMAT: ${post.format}`,
    `PILLAR: ${post.pillar ?? '(none)'}`,
    `CAPTION / IDEA:\n${post.caption ?? '(draft — infer from pillar)'}`,
    `HOOK PATTERNS TO WORK FROM (imitate the STRUCTURE, fill it with THIS post's content — never copy the illustrations):\n${patternBlock}`,
    `Write ${CANDIDATE_COUNT} distinct hooks for this post, each following one of the structures above and grounded in the caption/pillar and the client's voice. Return JSON: {"hooks": ["…", "…", "…"]}`,
  ].join('\n\n');

  const res = await model.complete({ model: HOOK_MODEL, system, messages: [{ role: 'user', content: user }], maxTokens: 700, temperature: 0.8 });

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
      action: 'content-cycle:hook', metadata: { cycleId: job.cycleId, postId: job.targetPostId },
    });
  } catch (err) {
    deps.logger.warn({ cycleId: job.cycleId, err: String(err) }, 'hook: audit log failed — non-fatal');
  }
  // A hook that carries the model's working notes ("let me…", word-count asides) is not a hook.
  // Drop contaminated candidates before the top one can be auto-selected and stored.
  const candidates = parseHooks(res.content).filter((h) => !hasDeliberativeMarkers(h)).slice(0, CANDIDATE_COUNT);
  if (candidates.length === 0) throw new Error('hook: model returned no usable hooks');

  // FAN-OUT: keep the top candidate. Ranked first by the same prompt that produced them,
  // so "top" is the model's own preference, not ours. The client can still change it — this
  // writes a hook where there would otherwise be none, it does not lock one in.
  if (job.autoSelect) {
    const chosen = candidates[0]!;
    await db.update(contentCyclePosts)
      .set({ hook: chosen })
      .where(and(
        eq(contentCyclePosts.id, job.targetPostId),
        eq(contentCyclePosts.cycleId, job.cycleId),
        eq(contentCyclePosts.clientId, job.clientId),
      ));
    try {
      await recordPlanActivity(db, {
        clientId: job.clientId, cycleId: job.cycleId, postId: job.targetPostId,
        action: 'hook_saved', actor: { origin: 'agent' },
      });
    } catch (err) {
      logger.warn({ ...logCtx, err: String(err) }, 'hook: ledger write failed — non-fatal');
    }
    logger.info({ ...logCtx, count: candidates.length }, 'hook: generated candidates and auto-selected the top one');
    return { candidates };
  }

  logger.info({ ...logCtx, count: candidates.length }, 'hook: generated candidates');
  return { candidates };
}
