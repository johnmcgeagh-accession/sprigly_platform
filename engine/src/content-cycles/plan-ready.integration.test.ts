/**
 * plan-ready.integration.test.ts — the settled predicate, the at-most-once claim, and
 * which template each arc selects.
 *
 * Integration rather than mocked, because the two things most likely to break are database
 * behaviours a mock would assert away: the atomic claim under genuine concurrency, and the
 * queue half of the predicate against a real BullMQ instance. A stubbed queue that returns
 * a list would prove nothing about job states.
 *
 * Requires Postgres AND Redis. Skipped cleanly without TEST_DATABASE_URL / TEST_REDIS_URL,
 * so the offline suite stays green.
 *
 *   DATABASE_URL=… TEST_DATABASE_URL=… TEST_REDIS_URL=… \
 *     pnpm --filter @sprigly/worker exec vitest run src/content-cycles/plan-ready.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

const TEST_DB    = process.env['TEST_DATABASE_URL'];
const TEST_REDIS = process.env['TEST_REDIS_URL'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe.skipIf(!TEST_DB || !TEST_REDIS)('plan-ready settlement (integration)', () => {
  let sql: Any, db: Any, M: Any, q: Any;

  // ONE queue for the file. Opening and closing an ioredis connection per test raced with
  // in-flight commands and surfaced as unhandled "Connection is closed" rejections.
  beforeAll(async () => {
    ({ sql, db } = await import('@sprigly/db'));
    const { Queue } = await import('bullmq');
    M = await import('./plan-ready.js');
    q = new Queue('content-cycles', { connection: { url: TEST_REDIS! } });
  });

  afterEach(async () => { await q.obliterate({ force: true }).catch(() => {}); });
  afterAll(async () => { await q?.close(); });

  async function fixture(opts: { approvedBy?: string | null; sent?: boolean } = {}): Promise<{ clientId: string; cycleId: string }> {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [{ id: clientId }] = await sql`
      INSERT INTO clients (name, slug, status) VALUES ('Plan Ready', ${`plan-ready-${stamp}`}, 'active') RETURNING id`;
    const [{ id: cycleId }] = await sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status, approved_at, approved_by, plan_ready_sent_at)
      VALUES (${clientId}, 'instagram', '2026-07', 'scheduled',
              ${opts.approvedBy === null ? null : sql`now()`},
              ${opts.approvedBy ?? null},
              ${opts.sent ? sql`now()` : null})
      RETURNING id`;
    return { clientId, cycleId };
  }

  async function addPost(clientId: string, cycleId: string, status: string, format = 'reel'): Promise<string> {
    const [{ id }] = await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, status)
      VALUES (${clientId}, ${cycleId}, 'instagram', '2026-08-04', ${format}, ${status}) RETURNING id`;
    return id as string;
  }

  // ── the predicate ──────────────────────────────────────────────────────────

  it('job-id matching accepts generation jobs and rejects the cycle-keyed jobs that are not', () => {
    const c = '11111111-1111-1111-1111-111111111111';
    expect(M.isGenerationJobForCycle(`shape_${c}_p1`, c)).toBe(true);
    expect(M.isGenerationJobForCycle(`hook_${c}_p1`, c)).toBe(true);
    expect(M.isGenerationJobForCycle(`script_${c}_p1`, c)).toBe(true);
    // Cycle-keyed but NOT generation work — these must never hold up a send.
    expect(M.isGenerationJobForCycle(`planning_${c}`, c)).toBe(false);
    expect(M.isGenerationJobForCycle(`weekly_${c}_2026-08-03`, c)).toBe(false);
    // Another cycle's job.
    expect(M.isGenerationJobForCycle('shape_22222222-2222-2222-2222-222222222222_p1', c)).toBe(false);
    expect(M.isGenerationJobForCycle(undefined, c)).toBe(false);
  });

  it('a post still generating means NOT settled', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId, 'generating');
    expect(await M.isCycleSettled(db, q, cycleId)).toBe(false);
  });

  it('generation_failed settles — it is terminal, and waiting would mean never sending', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId, 'generation_failed');
    await addPost(clientId, cycleId, 'new');
    expect(await M.isCycleSettled(db, q, cycleId)).toBe(true);
  });

  it('THE CASE POST-STATUS ALONE MISSES: all posts new, hook job still pending → NOT settled', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    const postId = await addPost(clientId, cycleId, 'new', 'reel');
    {
      // shape.ts:160 already moved the post to 'new'; hook.ts never writes status, so the
      // DB half is satisfied while real work is still queued.
      await q.add('hook', { type: 'hook', clientId, cycleId, targetPostId: postId },
        { jobId: `hook_${cycleId}_${postId}` });

      expect(await M.hasGeneratingPosts(db, cycleId)).toBe(false);   // DB half says done…
      expect(await M.isCycleSettled(db, q, cycleId)).toBe(false);    // …the predicate does not
    }
  });

  it('the asking job excludes itself, or nothing would ever settle', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    const postId = await addPost(clientId, cycleId, 'new');
    const jobId = `shape_${cycleId}_${postId}`;
    {
      await q.add('shape', { type: 'shape', clientId, cycleId, targetPostId: postId }, { jobId });
      expect(await M.isCycleSettled(db, q, cycleId)).toBe(false);          // counted
      expect(await M.isCycleSettled(db, q, cycleId, jobId)).toBe(true);    // excluded
    }
  });

  // ── the claim ──────────────────────────────────────────────────────────────

  it('RACE: concurrent claims yield exactly one winner', async () => {
    const { cycleId } = await fixture({ approvedBy: 'client' });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => M.claimPlanReadySend(db, cycleId)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);

    const rows = await sql`SELECT plan_ready_sent_at FROM content_cycles WHERE id = ${cycleId}`;
    expect(rows[0]!.plan_ready_sent_at).toBeTruthy();

    // And a later claim still loses.
    expect(await M.claimPlanReadySend(db, cycleId)).toBe(false);
  });

  it('BASELINE re-run sends nothing the second time', async () => {
    // planning.ts:1180 now wraps its send in this same claim. Before 0089 the send was
    // unconditional, so every completed planning run re-emailed the client
    // (investigation §6.5). A baseline cycle is never approved, hence approvedBy null.
    const { cycleId } = await fixture({ approvedBy: null });

    expect(await M.claimPlanReadySend(db, cycleId)).toBe(true);    // first run sends
    expect(await M.claimPlanReadySend(db, cycleId)).toBe(false);   // re-run does not
    expect(await M.claimPlanReadySend(db, cycleId)).toBe(false);
  });

  // ── the send ───────────────────────────────────────────────────────────────

  /** settlePlanReady with the email transport spied, so nothing leaves the process. */
  async function settleWithSpy(cycleId: string): Promise<{ outcome: string; calls: Any[] }> {
    const planning = await import('./planning.js');
    // Resolves TRUE: sendAppReadyNotification now reports whether the email actually went,
    // and a falsy result means "send failed" — which is a different test (below).
    const spy = vi.spyOn(planning, 'sendAppReadyNotification').mockResolvedValue(true as Any);
    const deps = {
      db, logger: { info() {}, warn() {}, error() {}, debug() {} },
      appBaseUrl: 'http://localhost:3000',
      encProvider: {}, googleClientId: '', googleClientSecret: '',
      model: {}, prompts: {}, audit: {},
    } as Any;
    try {
      const outcome = await M.settlePlanReady(deps, q, cycleId);
      return { outcome, calls: spy.mock.calls };
    } finally {
      spy.mockRestore();
    }
  }

  it('an auto-approved cycle sends the AUTO variant', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'auto' });
    await addPost(clientId, cycleId, 'new');
    const { outcome, calls } = await settleWithSpy(cycleId);

    expect(outcome).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]![5]).toBe(true);            // autoApproved
    expect(calls[0]![3]).toBe('August 2026');   // plan month = cycle month + 1
  });

  it('a client-approved cycle sends the ordinary variant', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId, 'new');
    const { outcome, calls } = await settleWithSpy(cycleId);

    expect(outcome).toBe('sent');
    expect(calls[0]![5]).toBe(false);           // autoApproved
  });

  it('settling twice sends once', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'auto' });
    await addPost(clientId, cycleId, 'new');

    const first  = await settleWithSpy(cycleId);
    const second = await settleWithSpy(cycleId);

    expect(first.outcome).toBe('sent');
    expect(first.calls).toHaveLength(1);
    expect(second.outcome).toBe('already_sent');
    expect(second.calls).toHaveLength(0);
  });

  it('a never-approved cycle is not this path to announce', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: null });
    await addPost(clientId, cycleId, 'new');
    const { outcome, calls } = await settleWithSpy(cycleId);

    expect(outcome).toBe('not_approved');
    expect(calls).toHaveLength(0);
    // …and the stamp was not burned, so the baseline path can still send.
    const rows = await sql`SELECT plan_ready_sent_at FROM content_cycles WHERE id = ${cycleId}`;
    expect(rows[0]!.plan_ready_sent_at).toBeNull();
  });

  it('does not send while work is in flight', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'auto' });
    await addPost(clientId, cycleId, 'generating');
    const { outcome, calls } = await settleWithSpy(cycleId);

    expect(outcome).toBe('not_settled');
    expect(calls).toHaveLength(0);
  });
});

// ── Send outcome is real, and failures retry (round two) ─────────────────────
// Before this the send's boolean was discarded: earl-of-east's October email failed with
// "No Gmail tokens for client" and the very next log line said 'settled and sent', leaving a
// stale plan_ready_sent_at that the at-most-once key would never retry
// (docs/reports/round-two-email-and-surface.md §A5-A6).

describe.skipIf(!TEST_DB || !TEST_REDIS)('plan-ready send outcome + sweep', () => {
  let sql: Any, db: Any, M: Any, q: Any, planning: Any;

  beforeAll(async () => {
    ({ sql, db } = await import('@sprigly/db'));
    const { Queue } = await import('bullmq');
    M        = await import('./plan-ready.js');
    planning = await import('./planning.js');
    q = new Queue(`content-cycles-sendfix-${process.pid}`, { connection: { url: TEST_REDIS! } });
  });
  afterEach(async () => { await q.obliterate({ force: true }).catch(() => {}); vi.restoreAllMocks(); });
  afterAll(async () => { await q?.close(); });

  async function fixture(opts: { approvedBy?: string | null } = {}): Promise<{ clientId: string; cycleId: string }> {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [{ id: clientId }] = await sql`
      INSERT INTO clients (name, slug, status) VALUES ('SendFix', ${`sendfix-${stamp}`}, 'active') RETURNING id`;
    const [{ id: cycleId }] = await sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status, approved_at, approved_by)
      VALUES (${clientId}, 'instagram', '2026-07', 'scheduled',
              ${opts.approvedBy === null ? null : sql`now()`}, ${opts.approvedBy ?? null})
      RETURNING id`;
    return { clientId, cycleId };
  }
  const addPost = async (clientId: string, cycleId: string, status = 'new') => {
    const [{ id }] = await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, status)
      VALUES (${clientId}, ${cycleId}, 'instagram', '2026-08-04', 'reel', ${status}) RETURNING id`;
    return id as string;
  };
  const stampOf = async (cycleId: string) =>
    (await sql`SELECT plan_ready_sent_at FROM content_cycles WHERE id = ${cycleId}`)[0].plan_ready_sent_at;

  /** Spy the transport. `ok` decides what the send reports. */
  function transport(ok: boolean) {
    return vi.spyOn(planning, 'sendAppReadyNotification').mockResolvedValue(ok as Any);
  }
  const deps = () => ({
    db, logger: { info() {}, warn() {}, error() {}, debug() {} },
    appBaseUrl: 'http://localhost:3000',
    encProvider: {}, googleClientId: '', googleClientSecret: '', model: {}, prompts: {}, audit: {},
  } as Any);

  it('a FAILED send releases the claim and reports send_failed — never sent', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId);
    const spy = transport(false);

    const outcome = await M.settlePlanReady(deps(), q, cycleId);

    expect(outcome).toBe('send_failed');
    expect(spy).toHaveBeenCalledOnce();
    // The claim is GIVEN BACK, so the cycle is retryable rather than stamped as delivered.
    expect(await stampOf(cycleId)).toBeNull();
  }, 60_000);

  it('a SUCCESSFUL send keeps the stamp and reports sent', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId);
    transport(true);

    expect(await M.settlePlanReady(deps(), q, cycleId)).toBe('sent');
    expect(await stampOf(cycleId)).toBeTruthy();
  }, 60_000);

  it('CONCURRENT settlements with a failing send: one attempt, claim released once', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId);
    const spy = transport(false);

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => M.settlePlanReady(deps(), q, cycleId)),
    );

    // Exactly one caller won the claim and therefore exactly one send was attempted…
    expect(spy).toHaveBeenCalledOnce();
    expect(outcomes.filter((o: string) => o === 'send_failed')).toHaveLength(1);
    // …and the cycle is left retryable, not half-claimed.
    expect(await stampOf(cycleId)).toBeNull();
  }, 60_000);

  it('SWEEP delivers a settled-but-unsent cycle once the transport works', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId);

    transport(false);
    expect(await M.settlePlanReady(deps(), q, cycleId)).toBe('send_failed');
    expect(await stampOf(cycleId)).toBeNull();

    // Transport fixed (e.g. the Gmail connection finally exists) — the sweep picks it up.
    vi.restoreAllMocks();
    const spy = transport(true);
    const res = await M.sweepUnsentPlanReady(deps(), q);

    expect(spy).toHaveBeenCalled();
    expect(res.sent).toBeGreaterThanOrEqual(1);
    expect(await stampOf(cycleId)).toBeTruthy();
  }, 60_000);

  it('SWEEP skips cycles mid-generation', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId, 'generating');
    const spy = transport(true);

    await M.sweepUnsentPlanReady(deps(), q);

    expect(spy).not.toHaveBeenCalled();
    expect(await stampOf(cycleId)).toBeNull();
  }, 60_000);

  it('SWEEP skips unapproved cycles — not this path to announce', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: null });
    await addPost(clientId, cycleId);
    const spy = transport(true);

    await M.sweepUnsentPlanReady(deps(), q);

    expect(spy).not.toHaveBeenCalled();
    expect(await stampOf(cycleId)).toBeNull();
  }, 60_000);

  it('SWEEP skips a cycle that already sent', async () => {
    const { clientId, cycleId } = await fixture({ approvedBy: 'client' });
    await addPost(clientId, cycleId);
    transport(true);
    await M.settlePlanReady(deps(), q, cycleId);
    const before = await stampOf(cycleId);

    vi.restoreAllMocks();
    const spy = transport(true);
    await M.sweepUnsentPlanReady(deps(), q);

    expect(spy).not.toHaveBeenCalled();          // not even a candidate
    expect(await stampOf(cycleId)).toEqual(before);
  }, 60_000);
});

// ── Ask coverage: did the delivered month carry the brief's undated asks? ─────
// September 2026 shipped 33 posts and dropped four of the client's verbatim opening hooks,
// and nothing noticed for a month. Settlement is where that becomes observable, because it
// is the one moment that knows the month is finished.

describe.skipIf(!TEST_DB || !TEST_REDIS)('plan-ready ask-coverage outcome', () => {
  let sql: Any, db: Any, M: Any, q: Any, planning: Any;

  beforeAll(async () => {
    ({ sql, db } = await import('@sprigly/db'));
    const { Queue } = await import('bullmq');
    M = await import('./plan-ready.js');
    planning = await import('./planning.js');
    q = new Queue('content-cycles', { connection: { url: TEST_REDIS! } });
  });
  afterEach(async () => { vi.restoreAllMocks(); await q.obliterate({ force: true }).catch(() => {}); });

  /**
   * Every client this block creates, removed at the end.
   *
   * The older blocks in this file leave their fixtures behind, which is survivable on a
   * throwaway database and rude on a shared UAT one — and this suite is most useful run against
   * UAT, where Postgres and Redis both already exist. Deleted FK-innermost first.
   */
  const created: string[] = [];
  afterAll(async () => {
    for (const clientId of created) {
      await sql`DELETE FROM audit_log             WHERE client_id = ${clientId}`.catch(() => {});
      await sql`DELETE FROM app_magic_link_tokens WHERE client_id = ${clientId}`.catch(() => {});
      await sql`DELETE FROM content_cycle_posts   WHERE client_id = ${clientId}`.catch(() => {});
      await sql`DELETE FROM content_cycles        WHERE client_id = ${clientId}`.catch(() => {});
      await sql`DELETE FROM clients               WHERE id        = ${clientId}`.catch(() => {});
    }
    await q?.close();
  });

  const ACTION = 'content-cycle:ask-coverage-outcome';

  /** The four hooks that went missing, plus the argument that landed. */
  const BRIEF_WITH_ASKS = {
    products: [], schedule: [], focus: [], conflicts: [], plan_window: { from: null, month: '2026-08' },
    content_asks: [
      { type: 'wardrobe-avoidance-hook', product: null, note: 'Hook: Do you avoid sorting your wardrobe out?' },
      { type: 'shop-your-wardrobe-hook', product: null, note: 'Hook: Do you avoid shopping your own wardrobe?' },
      { type: 'not-fast-fashion-brand-values', product: null, note: 'We do not compete with fast fashion because we do not make fast fashion at all, ever.' },
    ],
  };

  async function briefedCycle(brief: unknown): Promise<{ clientId: string; cycleId: string }> {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [{ id: clientId }] = await sql`
      INSERT INTO clients (name, slug, status) VALUES ('Ask Coverage', ${`ask-cov-${stamp}`}, 'active') RETURNING id`;
    const [{ id: cycleId }] = await sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status, approved_at, approved_by, structured_brief)
      VALUES (${clientId}, 'instagram', '2026-07', 'scheduled', now(), 'client', ${brief ? sql.unsafe(`'${JSON.stringify(brief).replace(/'/g, "''")}'::jsonb`) : null})
      RETURNING id`;
    created.push(clientId);
    return { clientId, cycleId };
  }

  async function addCaptioned(clientId: string, cycleId: string, caption: string, status = 'new'): Promise<void> {
    await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, status, caption)
      VALUES (${clientId}, ${cycleId}, 'instagram', '2026-08-04', 'reel', ${status}, ${caption})`;
  }

  const rows = async (clientId: string): Promise<Any[]> =>
    sql`SELECT metadata FROM audit_log WHERE client_id = ${clientId} AND action = ${ACTION}`;

  const deps = () => ({
    db, logger: { info() {}, warn() {}, error() {}, debug() {} },
    appBaseUrl: 'http://localhost:3000',
    encProvider: {}, googleClientId: '', googleClientSecret: '', model: {}, prompts: {}, audit: {},
  } as Any);

  it('a month that DROPPED asks: the row appears, names them, and settlement still sends', async () => {
    const { clientId, cycleId } = await briefedCycle(BRIEF_WITH_ASKS);
    await addCaptioned(clientId, cycleId, 'We do not compete with fast fashion because we do not make fast fashion at all, ever.');
    vi.spyOn(planning, 'sendAppReadyNotification').mockResolvedValue(true as Any);

    expect(await M.settlePlanReady(deps(), q, cycleId)).toBe('sent');

    const [row] = await rows(clientId);
    expect(row).toBeTruthy();
    expect(row.metadata.counts).toEqual({ used: 1, unused: 2, unmeasured: 0 });
    // The finding is legible from the row alone — the client's own missing sentences.
    const unused = row.metadata.asks.filter((a: Any) => a.verdict === 'unused');
    expect(unused.map((a: Any) => a.line).sort()).toEqual([
      'Do you avoid shopping your own wardrobe?',
      'Do you avoid sorting your wardrobe out?',
    ]);
  }, 60_000);

  it('a month with NO asks briefed writes no row at all', async () => {
    const { clientId, cycleId } = await briefedCycle({
      products: [], schedule: [], content_asks: [], focus: [], conflicts: [], plan_window: { from: null, month: '2026-08' },
    });
    await addCaptioned(clientId, cycleId, 'An ordinary caption.');
    vi.spyOn(planning, 'sendAppReadyNotification').mockResolvedValue(true as Any);

    expect(await M.settlePlanReady(deps(), q, cycleId)).toBe('sent');
    expect(await rows(clientId)).toHaveLength(0);
  }, 60_000);

  it('a cycle with no structured_brief writes no row, and settles unaffected', async () => {
    const { clientId, cycleId } = await briefedCycle(null);
    await addCaptioned(clientId, cycleId, 'An ordinary caption.');
    vi.spyOn(planning, 'sendAppReadyNotification').mockResolvedValue(true as Any);

    expect(await M.settlePlanReady(deps(), q, cycleId)).toBe('sent');
    expect(await rows(clientId)).toHaveLength(0);
  }, 60_000);

  it('the measurement THROWING never costs the delivery', async () => {
    const { clientId, cycleId } = await briefedCycle(BRIEF_WITH_ASKS);
    await addCaptioned(clientId, cycleId, 'Anything at all.');
    const send = vi.spyOn(planning, 'sendAppReadyNotification').mockResolvedValue(true as Any);
    // The detector itself blows up mid-settlement.
    const engine = await import('@sprigly/engine');
    vi.spyOn(engine, 'briefAskCoverage').mockImplementation(() => { throw new Error('detector exploded'); });

    // Settlement completes, the email still went, and the claim still stands.
    expect(await M.settlePlanReady(deps(), q, cycleId)).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
    const [{ plan_ready_sent_at: stamp }] = await sql`SELECT plan_ready_sent_at FROM content_cycles WHERE id = ${cycleId}`;
    expect(stamp).toBeTruthy();
    // …and no row was invented for a measurement that never happened.
    expect(await rows(clientId)).toHaveLength(0);
  }, 60_000);

  it('settlement touches NOTHING but audit_log — no posts, no cycles, no edits added', async () => {
    const { clientId, cycleId } = await briefedCycle(BRIEF_WITH_ASKS);
    await addCaptioned(clientId, cycleId, 'Anything at all.');
    vi.spyOn(planning, 'sendAppReadyNotification').mockResolvedValue(true as Any);

    const counts = async (): Promise<Any> => {
      const [r] = await sql`
        SELECT (SELECT count(*) FROM content_cycle_posts WHERE cycle_id = ${cycleId}) AS posts,
               (SELECT count(*) FROM content_cycles      WHERE id       = ${cycleId}) AS cycles,
               (SELECT count(*) FROM post_edits          WHERE cycle_id = ${cycleId}) AS edits,
               (SELECT count(*) FROM audit_log WHERE client_id = ${clientId} AND action = ${ACTION}) AS audit`;
      return r;
    };
    const before = await counts();
    expect(await M.settlePlanReady(deps(), q, cycleId)).toBe('sent');
    const after = await counts();

    expect(after.posts).toBe(before.posts);
    expect(after.cycles).toBe(before.cycles);
    expect(after.edits).toBe(before.edits);
    expect(Number(after.audit)).toBe(Number(before.audit) + 1);   // the one row it is allowed
  }, 60_000);
});
