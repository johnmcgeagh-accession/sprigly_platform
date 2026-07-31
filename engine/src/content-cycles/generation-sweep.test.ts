/**
 * generation-sweep.test.ts — the retry arm behind "on its way" (spec gap 7).
 *
 * The redesign takes the client's retry button away. These pin the three facts that make
 * that honest: a stuck caption gets picked up, it gets picked up a SECOND time, and then it
 * stops costing money and becomes something an operator sees instead.
 *
 * Mocked rather than integration: what is being asserted is the loop's decisions — enqueue
 * before stamp, the bound, the in-flight skip, the pass not consumed on a failed enqueue —
 * and none of those are database behaviours. The one thing a mock cannot check is the SQL
 * bound in the WHERE clause, which is why the bound is also asserted in code (see the
 * sweepExhausted guard) and exercised here with data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as { set: Record<string, unknown> }[],
  added: [] as { name: string; payload: Record<string, unknown>; opts: Record<string, unknown> }[],
}));

vi.mock('@sprigly/db', () => ({
  contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
}));

// @sprigly/engine resolves to built `dist/` output, which an offline unit run must not
// depend on. The instruction is stubbed to something recognisable; the bound and its reader
// are restated faithfully here and tested for real in
// packages/engine/src/generation-recovery.test.ts, where they live.
vi.mock('@sprigly/engine/generation-recovery', () => {
  const SWEEP_ATTEMPTS_KEY = 'generationSweepAttempts';
  const MAX_SWEEP_ATTEMPTS = 2;
  const sweepAttemptsOf = (sm: unknown): number => {
    if (!sm || typeof sm !== 'object') return 0;
    const v = (sm as Record<string, unknown>)[SWEEP_ATTEMPTS_KEY];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
  };
  return {
    captionInstruction: (title: string, pillar: string) => `caption:${title}:${pillar}`,
    sweepAttemptsOf,
    sweepExhausted: (sm: unknown) => sweepAttemptsOf(sm) >= MAX_SWEEP_ATTEMPTS,
    MAX_SWEEP_ATTEMPTS,
    SWEEP_ATTEMPTS_KEY,
  };
});

// NOT MOCKED, deliberately: the classification is the REAL one, because what these fixtures are
// about is what the sweep DOES with it and a stub would be testing the stub. It reaches
// `@sprigly/engine/ai-change-cap` through the package's own export map — the only way one
// workspace package may read another. A deep relative path into `packages/engine/src` resolved
// fine under vitest and broke the WORKER'S BUILD: `engine/tsconfig.json` sets `rootDir: "src"`
// and includes the tests, so an import climbing out of it is TS6059 on `pnpm --filter
// @sprigly/worker... build`. `turbo`'s `test` task depends on `^build`, so `dist` is there.

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => ['or', ...a],
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  lt: (a: unknown, b: unknown) => ['lt', a, b],
  isNull: (a: unknown) => ['isNull', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  inArray: (a: unknown, b: unknown) => ['inArray', a, b],
  sql: Object.assign((strings: TemplateStringsArray, ...v: unknown[]) => ['sql', strings.join('?'), v], { raw: (s: string) => s }),
}));

vi.mock('./scheduler.js', () => ({
  getLondonToday: () => ({ year: 2026, month: 7, day: 28 }),
}));

vi.mock('./job-options.js', () => ({ GENERATION_JOB_OPTIONS: { attempts: 3 } }));

vi.mock('./planning.js', () => ({}));

const db = {
  select: () => {
    const q: Record<string, unknown> = {};
    q['from']    = () => q;
    q['where']   = () => q;
    q['orderBy'] = () => q;
    q['limit']   = () => Promise.resolve(h.rows);
    return q;
  },
  update: () => ({
    set: (payload: Record<string, unknown>) => ({
      where: () => { h.updates.push({ set: payload }); return Promise.resolve(); },
    }),
  }),
} as never;

const logger = { info() {}, warn() {} } as never;

/** A BullMQ stand-in. `jobState` decides what getJob reports for an existing id. */
function makeQueue(opts: { existingState?: string | null; addThrows?: boolean } = {}) {
  return {
    getJob: async () => (opts.existingState == null ? null : { getState: async () => opts.existingState, remove: async () => {} }),
    add: async (name: string, payload: Record<string, unknown>, jobOpts: Record<string, unknown>) => {
      if (opts.addThrows) throw new Error('redis is down');
      h.added.push({ name, payload, opts: jobOpts });
    },
  } as never;
}

import { sweepFailedGenerations, instructionFor, MAX_SWEEP_ATTEMPTS, STRANDED_GENERATING_MS } from './generation-sweep.js';

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1', clientId: 'c1', cycleId: 'cyc1', pillar: 'Everyday Ritual',
  sourceMeta: { title: 'A small moment' },
  ...over,
});

beforeEach(() => { h.rows = []; h.updates = []; h.added = []; });

describe('the bound: once, twice, then it stops', () => {
  it('a first-time failure is re-enqueued and stamped with pass 1', async () => {
    h.rows = [post()];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.reenqueued).toBe(1);
    expect(h.added).toHaveLength(1);
    expect(h.added[0]!.name).toBe('shape');
    expect(h.added[0]!.opts['jobId']).toBe('shape_cyc1_p1');
    expect(h.updates[0]!.set['status']).toBe('generating');
    expect((h.updates[0]!.set['sourceMeta'] as Record<string, unknown>)['generationSweepAttempts']).toBe(1);
  });

  it('a post that already used one pass is re-enqueued and stamped with pass 2', async () => {
    h.rows = [post({ sourceMeta: { title: 'A small moment', generationSweepAttempts: 1 } })];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.reenqueued).toBe(1);
    expect((h.updates[0]!.set['sourceMeta'] as Record<string, unknown>)['generationSweepAttempts']).toBe(2);
  });

  it('a post that used both passes is NOT re-enqueued — it stops spending and becomes an operator item', async () => {
    h.rows = [post({ sourceMeta: { title: 'A small moment', generationSweepAttempts: MAX_SWEEP_ATTEMPTS } })];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.reenqueued).toBe(0);
    expect(h.added).toHaveLength(0);
    // Crucially it is NOT dragged out of generation_failed — the operator list reads that state.
    expect(h.updates).toHaveLength(0);
  });

});

describe('what the sweep will not do', () => {
  it('skips a post whose job is still in flight — something is already working on it', async () => {
    h.rows = [post()];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue({ existingState: 'active' }));

    expect(r.busy).toBe(1);
    expect(h.added).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it('clears a COMPLETED slot first, or BullMQ would deduplicate the re-enqueue into silence', async () => {
    h.rows = [post()];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue({ existingState: 'completed' }));

    expect(r.reenqueued).toBe(1);
    expect(h.added).toHaveLength(1);
  });

  it('does NOT consume a pass when the enqueue itself fails — nothing was spent', async () => {
    h.rows = [post()];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue({ addThrows: true }));

    expect(r.failed).toBe(1);
    expect(r.reenqueued).toBe(0);
    expect(h.updates).toHaveLength(0);   // no stamp → the next tick tries again from pass 0
  });

  it('never leaves a post reading generating with nothing queued: the stamp follows the enqueue', async () => {
    h.rows = [post()];
    await sweepFailedGenerations({ db, logger }, makeQueue({ addThrows: true }));
    expect(h.updates.some((u) => u.set['status'] === 'generating')).toBe(false);
  });

  it('one post failing does not end the pass for the rest', async () => {
    h.rows = [post({ id: 'p1' }), post({ id: 'p2' })];
    let first = true;
    const queue = {
      getJob: async () => null,
      add: async (name: string, payload: Record<string, unknown>, opts: Record<string, unknown>) => {
        if (first) { first = false; throw new Error('transient'); }
        h.added.push({ name, payload, opts });
      },
    } as never;

    const r = await sweepFailedGenerations({ db, logger }, queue);
    expect(r.failed).toBe(1);
    expect(r.reenqueued).toBe(1);
  });
});

/**
 * ── X4: the second status ────────────────────────────────────────────────────────────
 *
 * `generating` with nothing on the queue is the stuck state the sweep's own header says must
 * not exist, and until now nothing looked for it: a process dying between the insert and the
 * enqueue left a post reading *On its way* forever.
 *
 * The mocked db here returns whatever rows it is given, so what these pin is the LOOP's
 * treatment of a stranded row — that it is counted separately, re-enqueued on the same terms,
 * and skipped when a job really is in flight. The WHERE clause's age bound is a database
 * behaviour and is asserted as a constant rather than pretended at.
 */
describe('X4 — a post stranded in `generating` with nothing working on it', () => {
  it('is re-enqueued, and counted as stranded rather than as an ordinary failure', async () => {
    h.rows = [post({ status: 'generating' })];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.stranded).toBe(1);
    expect(r.reenqueued).toBe(1);
    expect(h.added).toHaveLength(1);
    expect((h.updates[0]!.set['sourceMeta'] as Record<string, unknown>)['generationSweepAttempts']).toBe(1);
  });

  it('is SKIPPED when a job for it is genuinely in flight — the queue is the real arbiter', async () => {
    h.rows = [post({ status: 'generating' })];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue({ existingState: 'waiting' }));

    expect(r.busy).toBe(1);
    expect(h.added).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it('an ordinary generation_failed post is NOT counted as stranded', async () => {
    h.rows = [post()];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());
    expect(r.stranded).toBe(0);
    expect(r.reenqueued).toBe(1);
  });

  it('takes the same spend bound as a failure — it is not a way round the cap', async () => {
    h.rows = [post({ status: 'generating', sourceMeta: { title: 'T', generationSweepAttempts: MAX_SWEEP_ATTEMPTS } })];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());
    expect(r.reenqueued).toBe(0);
    expect(h.updates).toHaveLength(0);
  });

  it('the age bound is far past any honest job and far short of the daily tick', () => {
    expect(STRANDED_GENERATING_MS).toBe(2 * 60 * 60 * 1000);
    // Three attempts, exponential from 5s, each capped at a 180s Bedrock call — minutes, not hours.
    expect(STRANDED_GENERATING_MS).toBeGreaterThan(30 * 60 * 1000);
    expect(STRANDED_GENERATING_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });
});

/**
 * ── X2e: three classes, three treatments ──────────────────────────────────────────────
 *
 * The sweep used to re-enqueue every failure twice, whatever had gone wrong. Two of the three
 * things that go wrong cannot be fixed by trying again, and the cost of not knowing which is
 * one paid Bedrock call per post per day.
 */
describe('X2e — the sweep classifies before it spends', () => {
  const failedWith = (error: string, extra: Record<string, unknown> = {}) =>
    post({ sourceMeta: { title: 'T', generationError: error, ...extra } });

  it('QUOTA is held, never retried — a refusal can only be refused again', async () => {
    h.rows = [failedWith('You’ve none left this month.', { quotaBanked: true })];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.quotaHeld).toBe(1);
    expect(r.reenqueued).toBe(0);
    expect(h.added).toHaveLength(0);
    expect(h.updates).toHaveLength(0);   // and it is NOT dragged out of its banked state
  });

  it('TRANSIENT is retried, under the same spend bound', async () => {
    h.rows = [failedWith('Bedrock timed out after 180s')];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.reenqueued).toBe(1);
    expect(r.operatorItems).toBe(0);
    expect(h.added).toHaveLength(1);
  });

  it('DETERMINISTIC stops on the FIRST pass and becomes an operator item', async () => {
    h.rows = [failedWith('Could not get that change on-brand — left the caption as it was.')];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.operatorItems).toBe(1);
    expect(r.reenqueued).toBe(0);
    expect(h.added).toHaveLength(0);
    // It keeps its state and its reason, which is what the admin list reads.
    expect(h.updates).toHaveLength(0);
  });

  it('an unrecognised error is deterministic — the default stops rather than bills', async () => {
    h.rows = [failedWith('something nobody has seen before')];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());
    expect(r.operatorItems).toBe(1);
    expect(h.added).toHaveLength(0);
  });

  it('a STRANDED post is none of the three, and is always re-enqueued', async () => {
    // No error at all: nothing ran. Classifying it would call it deterministic and strand it
    // for good, which is why the stranded branch is checked first.
    h.rows = [post({ status: 'generating', sourceMeta: { title: 'T' } })];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());
    expect(r.stranded).toBe(1);
    expect(r.operatorItems).toBe(0);
    expect(r.reenqueued).toBe(1);
  });

  it('a mixed pass treats each on its own terms and does not abandon the others', async () => {
    h.rows = [
      failedWith('You’ve none left this month.', { quotaBanked: true }),
      failedWith('ThrottlingException: Too many requests'),
      failedWith('Could not produce a clean caption for that change — left it unchanged.'),
    ];
    const r = await sweepFailedGenerations({ db, logger }, makeQueue());
    expect(r).toMatchObject({ considered: 3, quotaHeld: 1, reenqueued: 1, operatorItems: 1 });
  });
});

describe('the instruction is a retry, not a new brief', () => {
  it('re-runs the post’s own pending instruction when it has one', () => {
    expect(instructionFor({ pillar: 'X', sourceMeta: { pendingInstruction: 'make it about the restock' } }))
      .toBe('make it about the restock');
  });

  it('falls back to the deterministic fan-out instruction for the slot', () => {
    expect(instructionFor({ pillar: 'Home & Space', sourceMeta: { title: 'Wilderness relaunch' } }))
      .toBe('caption:Wilderness relaunch:Home & Space');
  });

  it('a blank pending instruction is not an instruction', () => {
    expect(instructionFor({ pillar: 'P', sourceMeta: { pendingInstruction: '   ', title: 'T' } }))
      .toBe('caption:T:P');
  });
});
