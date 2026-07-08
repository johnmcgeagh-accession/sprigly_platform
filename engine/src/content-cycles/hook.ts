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
import { assembleShapeContext } from './planning.js';
import type { PlanningDeps } from './planning.js';

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
  const candidates = parseHooks(res.content).slice(0, CANDIDATE_COUNT);
  if (candidates.length === 0) throw new Error('hook: model returned no usable hooks');

  logger.info({ ...logCtx, count: candidates.length }, 'hook: generated candidates');
  return { candidates };
}
