/**
 * cycle-reset.ts — return ONE content cycle to a genuinely never-run state.
 *
 * Why this exists: repeated end-to-end runs of the draft flow (assemble → intake reshape
 * → approve → phase 2) on a sandbox client need the next run to behave as a FIRST run.
 * The two existing "reset" affordances (admin `resetCycle` and `triggerCycle`) both
 * perform the same two-column status poke — `status='scheduled', request_sent_at=null` —
 * and leave everything that actually contaminates a re-run in place. (A third, the
 * `engine/src/reset-cycle.ts` CLI, did the same and was deleted in dd7c335.) The full
 * inventory and the evidence for each item is in
 * docs/reports/cycle-reset-investigation.md.
 *
 * Two survivors are hard blockers rather than cosmetic residue:
 *   - `approved_at` is written once (draft-approval-core.ts:141) and cleared nowhere, and
 *     both `draft-approval-core.ts:100` and `draft-mutations.ts:81` refuse on it — a
 *     status-reset cycle is permanently locked out of re-approval AND draft edits.
 *   - `post_edits` rows are counted by the monthly AI-change cap (usage.ts:44-55) over the
 *     CALENDAR month across all of a client's cycles. A generated 30-post month writes ~30
 *     rows, which is the default limit — so leaving them makes the next run's rewrites fail
 *     as quota-exhausted.
 *
 * SAFETY. This deletes rows. It refuses unless the cycle's client has `draft_flow_enabled`
 * (the sandbox marker) AND is not a protected tenant. Default mode is DRY RUN; the
 * destructive path requires an explicit --confirm. See `assertResettable`.
 */
import { readDraftFlowFlag } from '@sprigly/engine';

/**
 * Minimal structural type for the postgres.js handle we need. Declared rather than
 * imported so this module does not add a direct `postgres` dependency to the worker —
 * the caller passes the `sql` that @sprigly/db already exports.
 */
export interface SqlLike {
  <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> & { execute(): Promise<T[]> };
  begin<T>(fn: (tx: SqlLike) => Promise<T>): Promise<T>;
  unsafe(query: string): Promise<unknown[]>;
}

/**
 * Clients this tool must never touch, by client_id.
 *
 * Identified by the id `client_configs` is itself keyed on — NOT by matching a name or
 * slug substring, which would silently stop protecting the tenant the moment somebody
 * renamed it. The id is stable across environments (verified identical in UAT and prod).
 * Extend per-environment with RESET_CYCLE_PROTECTED_CLIENT_IDS (comma-separated).
 */
export const PROTECTED_CLIENT_IDS: readonly string[] = [
  'c79cf1c5-b51d-4a9b-aedc-48577df43e8f',   // live production tenant — never resettable
];

export function protectedClientIds(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const extra = (env['RESET_CYCLE_PROTECTED_CLIENT_IDS'] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...PROTECTED_CLIENT_IDS, ...extra]);
}

export interface CycleRef {
  id:         string;
  clientId:   string;
  channel:    string;
  cycleMonth: string;
  slug:       string | null;
}

export class ResetRefused extends Error {
  constructor(message: string) { super(message); this.name = 'ResetRefused'; }
}

/** Row counts per table, before and after. Also the dry-run projection. */
export type Counts = Record<string, number>;

/**
 * The tables this reset touches, each with the count query scoped to one cycle.
 *
 * This list IS the contamination inventory from the investigation — kept in one place so
 * the before/after summary, the dry-run projection and the delete order cannot drift apart.
 * Order is the DELETE order and is FK-safe top-to-bottom.
 */
export const TOUCHED = [
  'plan_activity',
  'agent_proposals',
  'agent_messages',
  'conversations',
  'post_edits',
  'post_steps',
  'content_cycle_posts',
  'planning_trace',
  'weekly_sessions',
  'plan_inputs_created',
  'plan_inputs_consumed',
] as const;

export async function countState(sql: SqlLike, cycleId: string): Promise<Counts> {
  const one = async (q: Promise<{ n: number }[]>): Promise<number> => Number((await q)[0]?.n ?? 0);
  return {
    plan_activity:        await one(sql`SELECT count(*)::int AS n FROM plan_activity WHERE cycle_id = ${cycleId}`),
    agent_proposals:      await one(sql`SELECT count(*)::int AS n FROM agent_proposals WHERE payload->>'cycleId' = ${cycleId}`),
    agent_messages:       await one(sql`SELECT count(*)::int AS n FROM agent_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE cycle_id = ${cycleId})`),
    conversations:        await one(sql`SELECT count(*)::int AS n FROM conversations WHERE cycle_id = ${cycleId}`),
    post_edits:           await one(sql`SELECT count(*)::int AS n FROM post_edits WHERE cycle_id = ${cycleId}`),
    post_steps:           await one(sql`SELECT count(*)::int AS n FROM post_steps WHERE post_id IN (SELECT id FROM content_cycle_posts WHERE cycle_id = ${cycleId})`),
    content_cycle_posts:  await one(sql`SELECT count(*)::int AS n FROM content_cycle_posts WHERE cycle_id = ${cycleId}`),
    planning_trace:       await one(sql`SELECT count(*)::int AS n FROM planning_trace WHERE cycle_id = ${cycleId}`),
    weekly_sessions:      await one(sql`SELECT count(*)::int AS n FROM weekly_sessions WHERE cycle_id = ${cycleId}`),
    plan_inputs_created:  await one(sql`SELECT count(*)::int AS n FROM plan_inputs WHERE cycle_id = ${cycleId}`),
    plan_inputs_consumed: await one(sql`SELECT count(*)::int AS n FROM plan_inputs WHERE used_in_cycle_id = ${cycleId}`),
  };
}

/** Resolve the cycle and its client. Throws ResetRefused if the id is not a cycle. */
export async function loadCycle(sql: SqlLike, cycleId: string): Promise<CycleRef> {
  const rows = await sql<{ id: string; client_id: string; channel: string; cycle_month: string; slug: string | null }>`
    SELECT c.id, c.client_id, c.channel, c.cycle_month, cl.slug
      FROM content_cycles c
      LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE c.id = ${cycleId}
     LIMIT 1`;
  const row = rows[0];
  if (!row) throw new ResetRefused(`no content_cycles row with id ${cycleId}`);
  return { id: row.id, clientId: row.client_id, channel: row.channel, cycleMonth: row.cycle_month, slug: row.slug };
}

/**
 * The sandbox guard. Throws ResetRefused — never returns false — so a caller cannot
 * accidentally treat a falsy result as "carry on". Performs ZERO writes.
 *
 * Both conditions must hold:
 *   1. draft_flow_enabled === true, read through the SAME strict predicate the worker
 *      uses (readDraftFlowFlag). A missing config row, `false`, `"true"` or `1` are all off.
 *   2. the client is not in the protected set.
 */
export async function assertResettable(
  sql: SqlLike,
  cycle: CycleRef,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (protectedClientIds(env).has(cycle.clientId)) {
    throw new ResetRefused(
      `client ${cycle.clientId}${cycle.slug ? ` (${cycle.slug})` : ''} is PROTECTED — this tool never resets it`,
    );
  }
  const rows = await sql<{ settings: Record<string, unknown> | null }>`
    SELECT settings FROM client_configs WHERE client_id = ${cycle.clientId} LIMIT 1`;
  if (!readDraftFlowFlag(rows[0]?.settings)) {
    throw new ResetRefused(
      `client ${cycle.clientId}${cycle.slug ? ` (${cycle.slug})` : ''} does not have draft_flow_enabled — ` +
      `this tool only resets sandbox clients running the draft flow`,
    );
  }
}

/**
 * The cycle-level columns returned to their never-run values.
 *
 * `status` goes to 'scheduled' (the schema default) and every stamp the arc writes is
 * nulled. Enumerated explicitly rather than by a wildcard so that a new column added to
 * content_cycles fails loudly in review instead of being silently missed.
 */
async function resetCycleRow(tx: SqlLike, cycleId: string): Promise<void> {
  await tx`
    UPDATE content_cycles SET
      status = 'scheduled', prior_status = NULL, failed_step = NULL,
      intake_source = NULL, intake_json = NULL, structured_brief = NULL,
      pending_deltas_json = NULL, lean_line = NULL,
      draft_csv_ref = NULL, workbook_ref = NULL,
      request_sent_at = NULL, reminded_at = NULL, reply_received_at = NULL,
      ask_sent_at = NULL, nudge_sent_at = NULL, last_call_sent_at = NULL,
      ask_skip_reason = NULL, nudge_skip_reason = NULL, last_call_skip_reason = NULL,
      delivered_at = NULL, finalised_at = NULL, voice_merged_at = NULL, closed_at = NULL,
      ig_input_status = NULL, ig_input_detail = NULL, ig_input_checked_at = NULL,
      posts_sync_status = NULL, posts_synced_at = NULL, posts_synced_run_id = NULL,
      approved_at = NULL, approved_by = NULL,
      -- Run state, not history: a reset cycle has not had its plan-ready email for THIS
      -- run, and leaving the stamp would silence the send on every subsequent test loop.
      plan_ready_sent_at = NULL,
      updated_at = now()
    WHERE id = ${cycleId}`;
}

export interface ResetResult {
  cycle:  CycleRef;
  before: Counts;
  after:  Counts;
  dryRun: boolean;
}

/**
 * Perform the reset inside ONE transaction.
 *
 * `session_replication_role = replica` is set LOCAL (so it reverts at transaction end) for
 * one specific reason: plan_activity carries a BEFORE UPDATE OR DELETE trigger that raises
 * unconditionally (migration 0068 — "block UPDATE and DELETE at the data layer"), and
 * plan_activity.post_id is ON DELETE SET NULL. Deleting a post therefore fires an internal
 * UPDATE on plan_activity and the trigger aborts the whole transaction. There is no
 * trigger-respecting route — deleting the activity rows first is blocked by the same
 * trigger. seed-e2e.ts:69-71 hit this and routed around it with TRUNCATE CASCADE, which is
 * not available to a per-cycle reset.
 *
 * CONSEQUENCE, and the reason post_steps is deleted explicitly below: replica mode also
 * disables referential actions, so the ON DELETE CASCADE from content_cycle_posts to
 * post_steps does NOT fire. Every child must be removed by hand, in FK order.
 */
export async function resetCycle(
  sql: SqlLike,
  cycleId: string,
  opts: { confirm: boolean; env?: NodeJS.ProcessEnv } = { confirm: false },
): Promise<ResetResult> {
  const env   = opts.env ?? process.env;
  const cycle = await loadCycle(sql, cycleId);
  await assertResettable(sql, cycle, env);

  const before = await countState(sql, cycleId);
  if (!opts.confirm) return { cycle, before, after: before, dryRun: true };

  await sql.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = 'replica'`;

    await tx`DELETE FROM plan_activity WHERE cycle_id = ${cycleId}`;
    await tx`DELETE FROM agent_proposals WHERE payload->>'cycleId' = ${cycleId}`;
    await tx`DELETE FROM agent_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE cycle_id = ${cycleId})`;
    await tx`DELETE FROM conversations WHERE cycle_id = ${cycleId}`;
    await tx`DELETE FROM post_edits WHERE cycle_id = ${cycleId}`;
    // Explicit: replica mode suppresses the ON DELETE CASCADE that would normally do this.
    await tx`DELETE FROM post_steps WHERE post_id IN (SELECT id FROM content_cycle_posts WHERE cycle_id = ${cycleId})`;
    await tx`DELETE FROM content_cycle_posts WHERE cycle_id = ${cycleId}`;
    await tx`DELETE FROM planning_trace WHERE cycle_id = ${cycleId}`;
    await tx`DELETE FROM weekly_sessions WHERE cycle_id = ${cycleId}`;

    // plan_inputs the run CREATED are capture artefacts of the run — remove them.
    await tx`DELETE FROM plan_inputs WHERE cycle_id = ${cycleId}`;
    // plan_inputs the run CONSUMED pre-dated it — return them to the backlog unconsumed
    // rather than destroying durable client ideas the run never owned.
    await tx`UPDATE plan_inputs SET used_in_cycle_id = NULL, lifecycle = 'candidate' WHERE used_in_cycle_id = ${cycleId}`;

    await resetCycleRow(tx, cycleId);
  });

  const after = await countState(sql, cycleId);
  return { cycle, before, after, dryRun: false };
}

/** Fixed-width before/after table. */
export function formatCounts(before: Counts, after: Counts): string {
  const w = Math.max(...TOUCHED.map((t) => t.length));
  const head = `${'table'.padEnd(w)}  ${'before'.padStart(6)}  ${'after'.padStart(6)}`;
  const rule = '-'.repeat(head.length);
  const body = TOUCHED.map((t) =>
    `${t.padEnd(w)}  ${String(before[t] ?? 0).padStart(6)}  ${String(after[t] ?? 0).padStart(6)}`);
  return [head, rule, ...body].join('\n');
}
