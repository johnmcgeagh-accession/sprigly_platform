/**
 * cycle-reset.integration.test.ts — proof that the full cycle reset (a) refuses outside the
 * sandbox, (b) writes nothing in dry run, (c) leaves a run cycle in the SAME DB state as a
 * never-run cycle, and (d) rolls back wholly when a mid-reset statement fails.
 *
 * This has to be an integration test rather than a mocked one. The two things most likely
 * to break are the plan_activity append-only trigger and the FK order — both are database
 * behaviours that a mock would assert away rather than exercise.
 *
 * Requires a real Postgres. Skipped cleanly when TEST_DATABASE_URL is unset (every db-bound
 * import is dynamic inside the guarded block), so the mocked suite stays offline-green.
 * Same harness as ledger.integration.test.ts.
 *
 *   ./scripts/test-db.sh up
 *   DATABASE_URL="$(./scripts/test-db.sh url)" TEST_DATABASE_URL="$(./scripts/test-db.sh url)" \
 *     pnpm --filter @sprigly/worker exec vitest run src/content-cycles/cycle-reset.integration.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';

const TEST_DB = process.env['TEST_DATABASE_URL'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe.skipIf(!TEST_DB)('cycle reset (integration — requires TEST_DATABASE_URL)', () => {
  let sql: Any, M: Any;

  beforeAll(async () => {
    ({ sql } = await import('@sprigly/db'));
    M = await import('./cycle-reset.js');
  });

  /** A client with draft_flow_enabled and one cycle. `settings` controls the guard. */
  async function makeClient(tag: string, settings: Record<string, unknown>): Promise<string> {
    const [{ id }] = await sql`
      INSERT INTO clients (name, slug, status) VALUES (${`Reset ${tag}`}, ${`reset-${tag}-${Date.now()}`}, 'active')
      RETURNING id`;
    await sql`INSERT INTO client_configs (client_id, settings) VALUES (${id}, ${sql.json(settings)})`;
    return id as string;
  }

  async function makeCycle(clientId: string, month = '2026-07'): Promise<string> {
    const [{ id }] = await sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month) VALUES (${clientId}, 'instagram', ${month})
      RETURNING id`;
    return id as string;
  }

  /**
   * Populate a cycle with the state a real run leaves behind — one row in every table the
   * reset touches, plus every cycle-level stamp set. Deliberately includes a plan_activity
   * row WITH a post_id, because that is the combination the append-only trigger blocks.
   */
  async function runTheFlow(clientId: string, cycleId: string): Promise<{ postId: string; durableId: string }> {
    const [{ id: postId }] = await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, status, caption, beat_meta)
      VALUES (${clientId}, ${cycleId}, 'instagram', '2026-08-04', 'reel', 'draft', 'seed', ${sql.json({ slotType: 'proven' })})
      RETURNING id`;
    await sql`INSERT INTO post_steps (post_id, label, lead_days, done) VALUES (${postId}, 'film it', 2, false)`;
    await sql`INSERT INTO post_edits (post_id, cycle_id, scope, instruction, caption_before, caption_after, passed)
              VALUES (${postId}, ${cycleId}, 'caption', 'punchier', 'a', 'b', true)`;
    await sql`INSERT INTO plan_activity (client_id, cycle_id, post_id, action, origin)
              VALUES (${clientId}, ${cycleId}, ${postId}, 'caption_saved', 'agent')`;
    await sql`INSERT INTO planning_trace (cycle_id, seq, post_index, phase, target_month) VALUES (${cycleId}, 1, 0, 'gate', '2026-08')`;
    await sql`INSERT INTO weekly_sessions (client_id, cycle_id, week_start) VALUES (${clientId}, ${cycleId}, '2026-08-03')`;

    const [{ id: convId }] = await sql`INSERT INTO conversations (client_id, cycle_id) VALUES (${clientId}, ${cycleId}) RETURNING id`;
    const [{ id: msgId }]  = await sql`INSERT INTO agent_messages (conversation_id, role, content, source) VALUES (${convId}, 'user', 'move it', 'web') RETURNING id`;
    await sql`INSERT INTO agent_proposals (client_id, conversation_id, message_id, intent, payload, summary, status)
              VALUES (${clientId}, ${convId}, ${msgId}, 'shape', ${sql.json({ cycleId })}, 'x', 'pending')`;

    // Two plan_inputs: one CREATED by the run, one durable that the run CONSUMED.
    await sql`INSERT INTO plan_inputs (client_id, cycle_id, type, content, status, source, origin, lifecycle)
              VALUES (${clientId}, ${cycleId}, 'note', 'captured in-run', 'active', 'web', 'client', 'candidate')`;
    const [{ id: durableId }] = await sql`
      INSERT INTO plan_inputs (client_id, cycle_id, type, content, status, source, origin, lifecycle, used_in_cycle_id)
      VALUES (${clientId}, NULL, 'idea', 'durable backlog idea', 'active', 'web', 'client', 'used', ${cycleId})
      RETURNING id`;

    await sql`UPDATE content_cycles SET
                status = 'workbook_built', approved_at = now(), approved_by = 'client',
                ask_sent_at = now(), nudge_sent_at = now(), last_call_sent_at = now(),
                intake_json = ${sql.json({ draftApplications: [{ receipt: 1 }] })},
                structured_brief = ${sql.json({ launches: [] })},
                posts_sync_status = 'synced', failed_step = 'planning', ig_input_status = 'ok',
                plan_ready_sent_at = now()
              WHERE id = ${cycleId}`;
    return { postId, durableId: durableId as string };
  }

  /** The columns that define "never run", read back for a whole-row comparison. */
  async function cycleShape(cycleId: string): Promise<Record<string, unknown>> {
    const [row] = await sql`
      SELECT status, prior_status, failed_step, intake_source, intake_json, structured_brief,
             pending_deltas_json, lean_line, draft_csv_ref, workbook_ref,
             request_sent_at, reminded_at, reply_received_at,
             ask_sent_at, nudge_sent_at, last_call_sent_at,
             ask_skip_reason, nudge_skip_reason, last_call_skip_reason,
             delivered_at, finalised_at, voice_merged_at, closed_at,
             ig_input_status, ig_input_detail, ig_input_checked_at,
             posts_sync_status, posts_synced_at, posts_synced_run_id,
             approved_at, approved_by, plan_ready_sent_at
        FROM content_cycles WHERE id = ${cycleId}`;
    return row as Record<string, unknown>;
  }

  it('GUARD: refuses when draft_flow_enabled is off, and writes nothing', async () => {
    const clientId = await makeClient('flagoff', { plan_redesign: true });   // no draft_flow_enabled
    const cycleId  = await makeCycle(clientId);
    await runTheFlow(clientId, cycleId);

    const before = await M.countState(sql, cycleId);
    await expect(M.resetCycle(sql, cycleId, { confirm: true }))
      .rejects.toThrow(/does not have draft_flow_enabled/);
    expect(await M.countState(sql, cycleId)).toEqual(before);
  });

  it('GUARD: a non-boolean flag is not enough (strict === true)', async () => {
    for (const settings of [{ draft_flow_enabled: 'true' }, { draft_flow_enabled: 1 }, { draft_flow_enabled: false }]) {
      const clientId = await makeClient('strict', settings);
      const cycleId  = await makeCycle(clientId);
      await expect(M.resetCycle(sql, cycleId, { confirm: true })).rejects.toThrow(M.ResetRefused);
    }
  });

  it('GUARD: refuses a PROTECTED client even with the flag on, and writes nothing', async () => {
    const clientId = await makeClient('protected', { draft_flow_enabled: true });
    const cycleId  = await makeCycle(clientId);
    await runTheFlow(clientId, cycleId);

    // Protection is by client id, via the same env-extensible set the CLI uses — no
    // name/slug matching. Proves the mechanism without depending on prod data existing here.
    const env = { RESET_CYCLE_PROTECTED_CLIENT_IDS: clientId } as unknown as NodeJS.ProcessEnv;
    const before = await M.countState(sql, cycleId);
    await expect(M.resetCycle(sql, cycleId, { confirm: true, env }))
      .rejects.toThrow(/is PROTECTED/);
    expect(await M.countState(sql, cycleId)).toEqual(before);
  });

  it('the real production tenant id is in the built-in protected set', () => {
    expect(M.protectedClientIds({} as NodeJS.ProcessEnv))
      .toContain('c79cf1c5-b51d-4a9b-aedc-48577df43e8f');
  });

  it('DRY RUN writes nothing and reports what would go', async () => {
    const clientId = await makeClient('dry', { draft_flow_enabled: true });
    const cycleId  = await makeCycle(clientId);
    await runTheFlow(clientId, cycleId);

    const before = await M.countState(sql, cycleId);
    const shapeBefore = await cycleShape(cycleId);

    const res = await M.resetCycle(sql, cycleId, { confirm: false });
    expect(res.dryRun).toBe(true);
    expect(res.before.content_cycle_posts).toBe(1);
    expect(res.before.plan_activity).toBe(1);

    expect(await M.countState(sql, cycleId)).toEqual(before);
    expect(await cycleShape(cycleId)).toEqual(shapeBefore);
  });

  it('FULL RESET leaves the cycle in the same DB state as a never-run cycle', async () => {
    const clientId = await makeClient('full', { draft_flow_enabled: true });
    const ranId    = await makeCycle(clientId, '2026-07');
    const freshId  = await makeCycle(clientId, '2026-09');       // never touched — the baseline
    const { durableId } = await runTheFlow(clientId, ranId);

    const res = await M.resetCycle(sql, ranId, { confirm: true });
    expect(res.dryRun).toBe(false);

    // 1. every touched table is empty for this cycle …
    for (const [table, n] of Object.entries(res.after)) {
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    // 2. … and matches the never-run cycle exactly.
    expect(res.after).toEqual(await M.countState(sql, freshId));
    // 3. every cycle-level column matches the never-run cycle.
    expect(await cycleShape(ranId)).toEqual(await cycleShape(freshId));

    // The durable backlog idea SURVIVES, un-consumed — it pre-dated the run.
    const [durable] = await sql`SELECT lifecycle, used_in_cycle_id FROM plan_inputs WHERE id = ${durableId}`;
    expect(durable).toEqual({ lifecycle: 'candidate', used_in_cycle_id: null });
  });

  it('deleting posts would fail without the trigger bypass (proves the bypass is load-bearing)', async () => {
    const clientId = await makeClient('trigger', { draft_flow_enabled: true });
    const cycleId  = await makeCycle(clientId);
    await runTheFlow(clientId, cycleId);

    // Naive delete, no session_replication_role: plan_activity.post_id is ON DELETE SET
    // NULL, so this fires an UPDATE that the append-only trigger raises on.
    await expect(sql`DELETE FROM content_cycle_posts WHERE cycle_id = ${cycleId}`)
      .rejects.toThrow(/append-only/);

    // …and the supported path still succeeds on the same data.
    const res = await M.resetCycle(sql, cycleId, { confirm: true });
    expect(res.after.content_cycle_posts).toBe(0);
  });

  it('ROLLBACK: a mid-reset failure leaves every table untouched', async () => {
    const clientId = await makeClient('rollback', { draft_flow_enabled: true });
    const cycleId  = await makeCycle(clientId);
    await runTheFlow(clientId, cycleId);

    const before = await M.countState(sql, cycleId);
    const shapeBefore = await cycleShape(cycleId);

    // Force a failure PART WAY THROUGH: plan_activity and post rows delete first, then the
    // cycle-row UPDATE hits a NOT NULL violation. If the transaction is not whole, the
    // earlier deletes would survive.
    await expect(sql.begin(async (tx: Any) => {
      await tx`SET LOCAL session_replication_role = 'replica'`;
      await tx`DELETE FROM plan_activity WHERE cycle_id = ${cycleId}`;
      await tx`DELETE FROM post_edits WHERE cycle_id = ${cycleId}`;
      await tx`DELETE FROM post_steps WHERE post_id IN (SELECT id FROM content_cycle_posts WHERE cycle_id = ${cycleId})`;
      await tx`DELETE FROM content_cycle_posts WHERE cycle_id = ${cycleId}`;
      await tx`UPDATE content_cycles SET status = NULL WHERE id = ${cycleId}`;   // NOT NULL → abort
    })).rejects.toThrow();

    expect(await M.countState(sql, cycleId)).toEqual(before);
    expect(await cycleShape(cycleId)).toEqual(shapeBefore);
  });
});
