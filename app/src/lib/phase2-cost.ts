/**
 * phase2-cost.ts — what did this cycle cost in model calls?
 *
 * Phase 2 is the most expensive thing the platform does: one caption generation per post,
 * each of which can trigger gate repairs and critic regenerations, plus a hook call per
 * eligible post and a script call per reel. A 30-beat month can be 60+ Bedrock calls before
 * a single retry. That number should never be a surprise.
 *
 * ── Why this is a read over audit_log, not a new table ───────────────────────
 * Every model call in the platform ALREADY writes an audit_log row with clientId, modelId,
 * token counts and an `action` string — including the phase-2 actions:
 *   'content-cycle:planning-repair'  (gate + critic regenerations, plan-validation.ts)
 *   'content-cycle:planning-critic'  (critic judgements)
 * plus the hook/script/refine calls. So the cost data exists; nothing was measuring it.
 * A new table would be a second source of truth for something already recorded, and would
 * be wrong the first time someone added a model call without remembering to instrument it.
 * Reading audit_log cannot drift, because the audit write is on the call path.
 *
 * The fan-out summary (posts, captions queued, hooks queued) is logged at enqueue time —
 * that is the one fact audit_log does not carry, since a queued job that never ran leaves
 * no model call behind.
 *
 * CAVEAT FOUND IN THE BUILD D DOGFOOD RUN: hook.ts and script.ts made ZERO audit writes,
 * so hook and script spend was invisible here — the first measured run reported 19 calls
 * when 23 had been made. Both are instrumented now. The lesson is the one the design
 * assumed away: reading the ledger only cannot drift IF every call site writes to it, and
 * two did not. Worth re-checking whenever a new model call is added.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db, auditLog, contentCycles, contentCyclePosts } from '@sprigly/db';

/** Actions on the phase-2 path, as written by the code that makes the calls. */
export const PHASE2_ACTIONS = [
  'content-cycle:planning-repair',   // caption generation + gate/critic regenerations
  'content-cycle:planning-critic',   // critic judgements
  'content-cycle:hook',              // hook candidates (instrumented in Build D)
  'content-cycle:script',            // reel scripts (instrumented in Build D)
] as const;

export interface Phase2Cost {
  cycleId:        string;
  postsTotal:     number;
  postsGenerated: number;
  postsFailed:    number;
  withHook:       number;
  withScript:     number;
  /** Model calls on the phase-2 path since approval, by action. */
  callsByAction:  Record<string, number>;
  totalCalls:     number;
  inputTokens:    number;
  outputTokens:   number;
  /** Calls per generated post — the number that tells you if something is looping. */
  callsPerPost:   number;
}

export interface Phase2RunSummary {
  clientId:        string;
  cycleId:         string;
  postsTotal:      number;
  captionsQueued:  number;
  hooksQueued:     number;
  enqueueFailures: number;
}

/**
 * Log the fan-out shape at enqueue time.
 *
 * A single structured line, matching how the rest of the platform records cycle events, so
 * "what did this cycle try to do" is answerable from logs alone even if every job then
 * fails. Deliberately not a DB write: the durable cost record is audit_log, and this is the
 * intent that preceded it.
 */
export async function recordPhase2Run(summary: Phase2RunSummary): Promise<void> {
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({ evt: 'phase2:fanout', ...summary }));
}

/**
 * Measure what a cycle's phase 2 actually cost.
 *
 * Counts model calls made SINCE the cycle was approved, so a re-approved or regenerated
 * cycle does not inherit the previous run's spend. Scoped by client because audit_log has
 * no cycle column — the trade-off of reading the existing ledger rather than adding one,
 * and the reason `approvedAt` is used as the lower bound rather than a run id.
 */
export async function measurePhase2Cost(clientId: string, cycleId: string): Promise<Phase2Cost> {
  const [cycle] = await db
    .select({ approvedAt: contentCycles.approvedAt })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);
  const since = cycle?.approvedAt ?? new Date(0);

  const posts = await db
    .select({ status: contentCyclePosts.status, hook: contentCyclePosts.hook, script: contentCyclePosts.script })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId)));

  const calls = await db
    .select({
      action: auditLog.action,
      n:      sql<number>`count(*)::int`,
      inTok:  sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::int`,
      outTok: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::int`,
    })
    .from(auditLog)
    .where(and(eq(auditLog.clientId, clientId), gte(auditLog.createdAt, since)))
    .groupBy(auditLog.action);

  const callsByAction: Record<string, number> = {};
  let totalCalls = 0, inputTokens = 0, outputTokens = 0;
  for (const row of calls) {
    const action = row.action ?? '(unlabelled)';
    callsByAction[action] = row.n;
    totalCalls += row.n;
    inputTokens += row.inTok;
    outputTokens += row.outTok;
  }

  const postsGenerated = posts.filter((p) => p.status === 'new' || p.status === 'edited').length;
  const postsFailed = posts.filter((p) => p.status === 'generation_failed').length;

  return {
    cycleId,
    postsTotal:     posts.length,
    postsGenerated,
    postsFailed,
    withHook:       posts.filter((p) => !!p.hook).length,
    withScript:     posts.filter((p) => !!p.script).length,
    callsByAction,
    totalCalls,
    inputTokens,
    outputTokens,
    callsPerPost:   postsGenerated > 0 ? Math.round((totalCalls / postsGenerated) * 10) / 10 : 0,
  };
}

/**
 * The ceiling a single post's generation should not exceed.
 *
 * MAX_PLAN_RETRIES is 3 (plan-validation.ts:60), and the loop can spend that on the gate
 * AND again on the critic, each critic attempt also costing a judgement call. So a
 * worst-case honest post is roughly: 1 caption + 3 gate repairs + 4 critic judgements +
 * 3 critic repairs ≈ 11, plus a hook and possibly a script. Anything materially above that
 * per post means a loop is not converging, which is a stop-and-report rather than a bill
 * to absorb quietly.
 */
export const CALLS_PER_POST_CEILING = 13;

export function exceedsCostCeiling(cost: Phase2Cost): boolean {
  return cost.callsPerPost > CALLS_PER_POST_CEILING;
}
