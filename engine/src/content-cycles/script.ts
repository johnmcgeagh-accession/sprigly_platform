/**
 * script.ts — Stage 6 reel generation: hook AND script, together, in ONE model call.
 *
 * The split this replaces welded a mismatched hook onto a reel. The script job took the hook
 * as immutable input and, when it did not fit, said so and used it anyway — "the hook doesn't
 * match the WSG arc at all… I'll use it verbatim as instructed" (round-two evidence). Two
 * calls, two chances to disagree. Now one call produces a COHERENT {hook, script}: the script
 * is built around the hook the same call just wrote, and both land atomically.
 *
 * Carousels keep the standalone hook job (hook.ts) — they have no script to cohere with. This
 * job runs for reels only, and it no longer requires a pre-existing hook (it writes one). It
 * still needs the caption, which is the post's subject.
 *
 * Reuses `assembleShapeContext` for voice and `hookPatternBlock` for the hook playbook, so a
 * reel's hook is written from the same patterns whichever path produced it. Emits both
 * `hook_saved` and `script_saved` plan_activity rows (origin=agent).
 */
import { and, eq } from 'drizzle-orm';
import { contentCycles, contentCyclePosts, hasRealCaption } from '@sprigly/db';
import { assembleShapeContext } from './planning.js';
import type { PlanningDeps } from './planning.js';
import { recordPlanActivity } from './ledger.js';
import { extractSection, hasDeliberativeMarkers } from './deliverable.js';
import { hookPatternBlock } from './hook.js';

const SCRIPT_WORKFLOW = 'plan_scripts';
const SCRIPT_STEP     = 'generate';
const SCRIPT_MODEL    = 'sonnet';
const WORDS_PER_SECOND = 2.2;   // spoken-word budget guidance

/** The response contract, enforced at the call site (not the mutable DB prompt) so it cannot
 *  drift per client and needs no migration. The parser tolerates the model ignoring it, and a
 *  leak is repaired once before it is ever stored. */
const COMBINED_OUTPUT_CONTRACT =
  'COMBINED OUTPUT CONTRACT: write ONE scroll-stopping hook for this reel, then a script that OPENS ON THAT HOOK and ' +
  'delivers the idea above within the target length. The two must be COHERENT — build the script around the hook you ' +
  'just wrote; never weld on a hook that does not fit. Think first if you need to, then output the hook after a line ' +
  'reading exactly ===HOOK=== and the script after a line reading exactly ===SCRIPT===. Keep the hook to a single ' +
  'line. Put NO reasoning, word counts, or register notes in either section — everything before ===HOOK=== is discarded.';

/** Sent on the one repair attempt when the first answer leaked its working notes. */
const REPAIR_REMINDER =
  'Your previous answer let working notes into the output. Return ONLY the hook after a line reading exactly ===HOOK=== ' +
  'and the script after a line reading exactly ===SCRIPT===, each clean — no word-count arithmetic, no "actually…"/"let ' +
  'me…" asides, and no commentary of any kind.';

export interface ScriptJob {
  type:          'script';
  clientId:      string;
  cycleId:       string;
  targetPostId:  string;
  lengthSeconds: number;   // 15 | 30 | 60 | 90
}
export interface ScriptResultData { changedPostIds: string[]; summary: string; }

/** One coherent hook + script from a raw response, or nulls where a section is missing. */
function parsePair(raw: string): { hook: string | null; script: string | null } {
  const hookSection = extractSection(raw, 'HOOK');
  const hook = hookSection ? hookSection.split('\n').map((l) => l.trim()).find(Boolean) ?? null : null;
  return { hook, script: extractSection(raw, 'SCRIPT') };
}

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
  // No hook precondition any more — this call WRITES the hook. The caption is the subject.
  // A placeholder is not a caption: the row is non-empty and the content does not exist.
  // Guarded here as well as at the route because this is the end that spends money.
  if (!hasRealCaption(post.caption)) throw new Error('script: a real caption is required');

  const ctx = await assembleShapeContext(cycle, deps);
  const patternBlock = await hookPatternBlock(db, post.format);
  const targetWords = Math.round(job.lengthSeconds * WORDS_PER_SECOND);

  const system = await prompts.resolve(job.clientId, SCRIPT_WORKFLOW, SCRIPT_STEP);
  const user = [
    ctx.voiceMd ? `CLIENT VOICE (voice.md):\n${ctx.voiceMd}` : 'CLIENT VOICE: (unavailable — keep it plain and on-brand).',
    `PILLAR: ${post.pillar ?? '(none)'}`,
    `CAPTION / IDEA:\n${post.caption}`,
    `HOOK PATTERNS TO WORK FROM (imitate the STRUCTURE, fill it with THIS reel's content — never copy the illustrations):\n${patternBlock}`,
    `TARGET LENGTH: ${job.lengthSeconds}s (~${targetWords} spoken words at ${WORDS_PER_SECOND} words/second — keep the whole script within that budget).`,
    COMBINED_OUTPUT_CONTRACT,
  ].join('\n\n');

  // ── AUDIT: every call is on the cost-guard's ledger ────────────────────────
  // hook and script spend was invisible to phase2-cost.ts until Build D — it reads audit_log
  // on the assumption that every call site writes to it, and two did not. The structural cure
  // is a Bedrock wrapper that writes the audit entry itself; until that lands (31 sites, many
  // with no clientId — docs/reports/hardening-pre-uat.md §4), ANY new model call needs its own
  // write. The repair call is a real Bedrock call, so it is audited too. One call now produces
  // BOTH hook and script — half the reel's generation spend versus the old hook+script split.
  const complete = async (content: string) => {
    const r = await model.complete({ model: SCRIPT_MODEL, system, messages: [{ role: 'user', content }], maxTokens: 1400, temperature: 0.6 });
    try {
      await deps.audit.logModelCall({
        // Kept as 'content-cycle:script' — this is still the reel's script job (it now also
        // produces the hook), and phase2-cost.ts counts spend by this exact action string.
        clientId: job.clientId, modelId: r.modelId, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        action: 'content-cycle:script', metadata: { cycleId: job.cycleId, postId: job.targetPostId, lengthSeconds: job.lengthSeconds, combined: true },
      });
    } catch (err) {
      logger.warn({ ...logCtx, err: String(err) }, 'script: audit log failed — non-fatal');
    }
    return r;
  };

  // Deliverables contain deliverables only. Keep the ===HOOK===/===SCRIPT=== sections, discard
  // the reasoning around them, and check both for leaked working notes. Missing a section or a
  // contaminated one repairs ONCE; if it is still wrong, FLAG it (a loud failure) rather than
  // store a mismatched or contaminated pair as the client's reel.
  const clean = (p: { hook: string | null; script: string | null }): boolean =>
    !!p.hook && !!p.script && !hasDeliberativeMarkers(p.hook) && !hasDeliberativeMarkers(p.script);

  let pair = parsePair((await complete(user)).content);
  if (!clean(pair)) {
    logger.warn({ ...logCtx }, 'script: hook/script pair incomplete or leaked — repairing once');
    pair = parsePair((await complete(`${user}\n\n${REPAIR_REMINDER}`)).content);
    if (!clean(pair)) {
      throw new Error('script: could not produce a clean hook+script pair — withheld rather than stored');
    }
  }
  const { hook, script } = pair as { hook: string; script: string };

  // Both land atomically — a reel is never left with one half of a pair.
  await db.update(contentCyclePosts)
    .set({ hook, script, scriptLengthSeconds: job.lengthSeconds })
    .where(and(eq(contentCyclePosts.id, post.id), eq(contentCyclePosts.cycleId, job.cycleId), eq(contentCyclePosts.clientId, job.clientId)));

  // Ledger both, agent-authored (deviation-3). Best-effort — a ledger miss must not fail the job.
  for (const action of ['hook_saved', 'script_saved'] as const) {
    try {
      await recordPlanActivity(db, {
        clientId: cycle.clientId, cycleId: job.cycleId, postId: post.id,
        action, actor: { origin: 'agent', actor: 'agent' },
        ...(action === 'script_saved' ? { payload: { lengthSeconds: job.lengthSeconds } } : {}),
      });
    } catch (err) {
      logger.warn({ ...logCtx, action, err: String(err) }, 'script: plan_activity ledger write failed — non-fatal');
    }
  }

  logger.info({ ...logCtx }, 'script: generated coherent hook + script and wrote both');
  return { changedPostIds: [post.id], summary: 'Wrote your reel hook and script.' };
}
