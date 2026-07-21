/**
 * fan-out-hooks.integration.test.ts — the approval fan-out leaves every eligible post with
 * a hook, and every reel with a script queued behind it.
 *
 * The defect: hook.ts returned candidates and wrote nothing, which is right interactively
 * and fatal in the fan-out — 7 hook jobs ran and were billed for cycle 040d6a1a, and every
 * hook stayed null. Scripts are gated on a hook existing, so none were ever enqueued
 * (docs/reports/wrong-month-generated.md §5b–5c).
 *
 * Requires Postgres AND Redis; skipped cleanly without TEST_DATABASE_URL / TEST_REDIS_URL.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// runHookForPost pulls client voice through assembleShapeContext, which needs Drive tokens.
// Voice is not what these tests are about — they are about whether the RESULT is persisted —
// so the context is stubbed and everything else runs for real against Postgres and Redis.
vi.mock('./planning.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  assembleShapeContext: async () => ({ voiceMd: 'be plain and warm' }),
}));

const TEST_DB    = process.env['TEST_DATABASE_URL'];
const TEST_REDIS = process.env['TEST_REDIS_URL'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe.skipIf(!TEST_DB || !TEST_REDIS)('fan-out hooks + scripts (integration)', () => {
  let sql: Any, db: Any, q: Any, hook: Any, scriptReady: Any, planReady: Any;

  const LOGGER = { info() {}, warn() {}, error() {}, debug() {} } as Any;

  beforeAll(async () => {
    ({ sql, db } = await import('@sprigly/db'));
    const { Queue } = await import('bullmq');
    hook        = await import('./hook.js');
    scriptReady = await import('./script-ready.js');
    planReady   = await import('./plan-ready.js');
    // Its OWN queue name: plan-ready.integration.test.ts also drives 'content-cycles' on
    // this Redis and obliterates between tests, so sharing the name makes the two files
    // delete each other's jobs when vitest runs them in parallel. Nothing under test cares
    // about the name — these helpers scan whatever queue they are handed.
    q = new Queue(`content-cycles-fanout-${process.pid}`, { connection: { url: TEST_REDIS! } });
  });
  afterEach(async () => { await q.obliterate({ force: true }).catch(() => {}); });
  afterAll(async () => { await q?.close(); });

  /** One active pattern per format — runHookForPost refuses without a matching pattern. */
  async function seedPatterns(): Promise<void> {
    const n = await sql`SELECT count(*)::int n FROM hook_patterns WHERE active = true`;
    if (n[0].n > 0) return;
    await sql`INSERT INTO hook_patterns (name, pattern, example, formats, category, active)
              VALUES ('Test', 'A {thing} that {does}', 'An example hook', ${sql.array(['reel', 'carousel'])}, 'test', true)`;
  }

  async function fixture(): Promise<{ clientId: string; cycleId: string }> {
    await seedPatterns();
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [{ id: clientId }] = await sql`
      INSERT INTO clients (name, slug, status) VALUES ('Fan Out', ${`fanout-${stamp}`}, 'active') RETURNING id`;
    const [{ id: cycleId }] = await sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status, approved_at, approved_by)
      VALUES (${clientId}, 'instagram', '2026-09', 'scheduled', now(), 'client') RETURNING id`;
    return { clientId, cycleId };
  }

  const addPost = async (clientId: string, cycleId: string, format: string, over: Record<string, unknown> = {}) => {
    const [{ id }] = await sql`
      INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, status, caption, hook, script)
      VALUES (${clientId}, ${cycleId}, 'instagram', '2026-10-04', ${format}, 'generating',
              ${(over['caption'] as string) ?? null}, ${(over['hook'] as string) ?? null}, ${(over['script'] as string) ?? null})
      RETURNING id`;
    return id as string;
  };

  /** A model that returns three parseable hook candidates. */
  const model = {
    complete: async () => ({
      content: '1. First hook line\n2. Second hook line\n3. Third hook line',
      modelId: 'test-model', inputTokens: 10, outputTokens: 10,
    }),
  } as Any;
  const deps = () => ({
    db, model, logger: LOGGER,
    prompts: { resolve: async () => ({ system: 'sys', user: 'usr' }) },
    audit: { logModelCall: async () => {} },
    encProvider: {}, googleClientId: '', googleClientSecret: '',
  } as Any);

  it('INTERACTIVE: returns candidates and writes NOTHING (byte-unchanged behaviour)', async () => {
    const { clientId, cycleId } = await fixture();
    const postId = await addPost(clientId, cycleId, 'reel', { caption: 'a caption' });

    const res = await hook.runHookForPost(
      { type: 'hook', clientId, cycleId, targetPostId: postId },   // no autoSelect
      deps(),
    );

    expect(res.candidates.length).toBeGreaterThan(0);
    const [row] = await sql`SELECT hook FROM content_cycle_posts WHERE id = ${postId}`;
    expect(row.hook).toBeNull();
    // …and no ledger entry either — nothing happened to the post.
    const act = await sql`SELECT count(*)::int n FROM plan_activity WHERE post_id = ${postId}`;
    expect(act[0].n).toBe(0);
  }, 60_000);

  it('FAN-OUT: persists the top candidate and records it', async () => {
    const { clientId, cycleId } = await fixture();
    const postId = await addPost(clientId, cycleId, 'carousel', { caption: 'a caption' });

    const res = await hook.runHookForPost(
      { type: 'hook', clientId, cycleId, targetPostId: postId, autoSelect: true },
      deps(),
    );

    const [row] = await sql`SELECT hook FROM content_cycle_posts WHERE id = ${postId}`;
    expect(row.hook).toBe(res.candidates[0]);          // the model's own first choice
    expect(row.hook).toBeTruthy();
    const act = await sql`SELECT action, origin FROM plan_activity WHERE post_id = ${postId}`;
    expect(act).toEqual([{ action: 'hook_saved', origin: 'agent' }]);
  }, 60_000);

  it('SCRIPT CHAIN: a reel with hook + caption enqueues a script; nothing else does', async () => {
    const { clientId, cycleId } = await fixture();
    const ready   = await addPost(clientId, cycleId, 'reel',     { caption: 'c', hook: 'h' });
    const noHook  = await addPost(clientId, cycleId, 'reel',     { caption: 'c' });
    const noCap   = await addPost(clientId, cycleId, 'reel',     { hook: 'h' });
    const carousel= await addPost(clientId, cycleId, 'carousel', { caption: 'c', hook: 'h' });
    const done    = await addPost(clientId, cycleId, 'reel',     { caption: 'c', hook: 'h', script: 'already written' });

    expect(await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, ready)).toBe(true);
    expect(await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, noHook)).toBe(false);
    expect(await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, noCap)).toBe(false);
    expect(await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, carousel)).toBe(false);
    expect(await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, done)).toBe(false);

    const ids = (await q.getJobs(['waiting', 'delayed', 'active'])).map((j: Any) => j.id);
    expect(ids).toEqual([scriptReady.scriptJobId(cycleId, ready)]);
  }, 60_000);

  it('SCRIPT CHAIN is idempotent — a second check does not queue a second paid job', async () => {
    const { clientId, cycleId } = await fixture();
    const postId = await addPost(clientId, cycleId, 'reel', { caption: 'c', hook: 'h' });

    await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, postId);
    await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, postId);

    const ids = (await q.getJobs(['waiting', 'delayed', 'active'])).map((j: Any) => j.id);
    expect(ids).toHaveLength(1);
  }, 60_000);

  it('SETTLEMENT does not fire while a script job is queued', async () => {
    const { clientId, cycleId } = await fixture();
    const postId = await addPost(clientId, cycleId, 'reel', { caption: 'c', hook: 'h' });
    await sql`UPDATE content_cycle_posts SET status = 'new' WHERE cycle_id = ${cycleId}`;

    // Nothing generating, nothing queued → settled.
    expect(await planReady.isCycleSettled(db, q, cycleId)).toBe(true);

    // Queue the script; the cycle must stop being settled.
    await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, postId);
    expect(await planReady.isCycleSettled(db, q, cycleId)).toBe(false);
  }, 60_000);

  it('POST-FAN-OUT STATE: every carousel and reel has a hook; every reel has a script queued', async () => {
    const { clientId, cycleId } = await fixture();
    const formats = ['carousel', 'reel', 'single', 'reel', 'carousel'];
    const ids: string[] = [];
    for (const f of formats) ids.push(await addPost(clientId, cycleId, f, { caption: 'a caption' }));

    // The fan-out: a hook job per eligible post, in autoSelect mode.
    for (let i = 0; i < formats.length; i++) {
      if (formats[i] === 'single') continue;
      await hook.runHookForPost({ type: 'hook', clientId, cycleId, targetPostId: ids[i]!, autoSelect: true }, deps());
      await scriptReady.enqueueScriptIfReady({ db, logger: LOGGER }, q, clientId, cycleId, ids[i]!);
    }

    const rows = await sql<Any[]>`
      SELECT format, (hook IS NOT NULL) AS has_hook FROM content_cycle_posts
      WHERE cycle_id = ${cycleId} ORDER BY format, id`;
    for (const r of rows) {
      expect({ format: r.format, has_hook: r.has_hook })
        .toEqual({ format: r.format, has_hook: r.format !== 'single' });
    }

    const queued = (await q.getJobs(['waiting', 'delayed', 'active'])).map((j: Any) => j.id).sort();
    const expected = formats
      .map((f, i) => (f === 'reel' ? scriptReady.scriptJobId(cycleId, ids[i]!) : null))
      .filter(Boolean).sort();
    expect(queued).toEqual(expected);
  }, 60_000);
});
