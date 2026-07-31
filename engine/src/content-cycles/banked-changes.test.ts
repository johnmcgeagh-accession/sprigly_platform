/**
 * banked-changes.test.ts — the promise a banked post makes, kept (X2b).
 *
 * A post the monthly change cap refused says, on the client's own calendar, that it will be
 * written when their changes refresh. That sentence is only honest if something actually does
 * it. These pin the loop's decisions: the allowance is respected, it is spent DOWN rather than
 * re-read, the flag is cleared only after the job is genuinely queued, and a client with no
 * allowance yet is left exactly as they were.
 *
 * Mocked rather than integration for the same reason the sweep's fixtures are: what is being
 * asserted is what the loop decides, and none of that is a database behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as { set: Record<string, unknown> }[],
  added: [] as { name: string; payload: Record<string, unknown>; opts: Record<string, unknown> }[],
  /** Allowance per `${clientId}:${channel}`, as the shared read would report it. */
  usage: {} as Record<string, { used: number; limit: number; overrideUntil: string | null }>,
  usageReads: 0,
}));

vi.mock('@sprigly/db', () => ({
  contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
  contentCycles: new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
  readAiChangeUsage: async (_db: unknown, clientId: string, channel: string) => {
    h.usageReads++;
    const u = h.usage[`${clientId}:${channel}`] ?? { used: 0, limit: 30, overrideUntil: null };
    return { ...u, resetsOn: '2026-08-01T00:00:00.000Z', unlimited: false };
  },
}));

// The REAL rules — what is being tested is how the loop uses them.
vi.mock('@sprigly/engine/ai-change-cap', async () => await import('../../../packages/engine/src/ai-change-cap.js'));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  asc: (a: unknown) => ['asc', a],
  sql: Object.assign((strings: TemplateStringsArray, ...v: unknown[]) => ['sql', strings.join('?'), v], { raw: (s: string) => s }),
}));

vi.mock('./scheduler.js', () => ({ getLondonToday: () => ({ year: 2026, month: 8, day: 1 }) }));
vi.mock('./job-options.js', () => ({ GENERATION_JOB_OPTIONS: { attempts: 3 } }));
vi.mock('./planning.js', () => ({}));
vi.mock('./generation-sweep.js', () => ({
  shapeJobId: (cycleId: string, postId: string) => `shape_${cycleId}_${postId}`,
  instructionFor: (p: { sourceMeta: Record<string, unknown> }) => String(p.sourceMeta['pendingInstruction'] ?? 'fallback'),
}));

const db = {
  select: () => {
    const q: Record<string, unknown> = {};
    q['from']      = () => q;
    q['innerJoin'] = () => q;
    q['where']     = () => q;
    q['orderBy']   = () => q;
    q['limit']     = () => Promise.resolve(h.rows);
    return q;
  },
  update: () => ({
    set: (payload: Record<string, unknown>) => ({
      where: () => { h.updates.push({ set: payload }); return Promise.resolve(); },
    }),
  }),
} as never;

const logger = { info() {}, warn() {} } as never;

function makeQueue(opts: { existingState?: string | null; addThrows?: boolean } = {}) {
  return {
    getJob: async () => (opts.existingState == null ? null : { getState: async () => opts.existingState, remove: async () => {} }),
    add: async (name: string, payload: Record<string, unknown>, jobOpts: Record<string, unknown>) => {
      if (opts.addThrows) throw new Error('redis is down');
      h.added.push({ name, payload, opts: jobOpts });
    },
  } as never;
}

import { releaseBankedChanges } from './banked-changes.js';

const banked = (id: string, over: Record<string, unknown> = {}) => ({
  id, clientId: 'c1', cycleId: 'cyc1', channel: 'instagram', pillar: 'Launch',
  sourceMeta: { quotaBanked: true, quotaBankedAt: '2026-07-20T09:00:00Z', pendingInstruction: `write ${id}`, generationError: 'Waiting for your changes to refresh on 1 August.' },
  ...over,
});

beforeEach(() => {
  h.rows = []; h.updates = []; h.added = []; h.usage = {}; h.usageReads = 0;
});

describe('the allowance came back', () => {
  it('a banked post is enqueued with its OWN stored instruction, not a new brief', async () => {
    h.rows = [banked('p1')];
    const r = await releaseBankedChanges({ db, logger }, makeQueue());

    expect(r.released).toBe(1);
    expect(h.added).toHaveLength(1);
    expect(h.added[0]!.payload['instruction']).toBe('write p1');
    expect(h.added[0]!.opts['jobId']).toBe('shape_cyc1_p1');
  });

  it('and the flag, the banked stamp and the message all go — the post is genuinely coming now', async () => {
    h.rows = [banked('p1')];
    await releaseBankedChanges({ db, logger }, makeQueue());

    const meta = h.updates[0]!.set['sourceMeta'] as Record<string, unknown>;
    expect(h.updates[0]!.set['status']).toBe('generating');
    expect(meta['quotaBanked']).toBeUndefined();
    expect(meta['quotaBankedAt']).toBeUndefined();
    expect(meta['generationError']).toBeUndefined();
    // The instruction stays: it is what the job is running.
    expect(meta['pendingInstruction']).toBe('write p1');
  });

  it('the client asked for this, so the ledger says client — not the tick that finally ran it', async () => {
    h.rows = [banked('p1')];
    await releaseBankedChanges({ db, logger }, makeQueue());
    expect(h.added[0]!.payload['actor']).toBe('client');
  });
});

describe('spending the allowance', () => {
  it('releases only as many as there is allowance for, and leaves the rest banked', async () => {
    h.usage['c1:instagram'] = { used: 28, limit: 30, overrideUntil: null };   // two left
    h.rows = [banked('p1'), banked('p2'), banked('p3'), banked('p4')];
    const r = await releaseBankedChanges({ db, logger }, makeQueue());

    expect(r.released).toBe(2);
    expect(r.stillHeld).toBe(2);
    expect(h.added.map((a) => a.payload['targetPostId'])).toEqual(['p1', 'p2']);
    // The two that stayed are untouched — flag intact, message intact, still true.
    expect(h.updates).toHaveLength(2);
  });

  it('THE BUDGET IS SPENT DOWN, NOT RE-READ — post_edits only moves when the job completes', async () => {
    h.usage['c1:instagram'] = { used: 28, limit: 30, overrideUntil: null };
    h.rows = [banked('p1'), banked('p2'), banked('p3')];
    await releaseBankedChanges({ db, logger }, makeQueue());
    // One read for the (client, channel), not one per post. Re-reading would return 28 every
    // time and release all three into a budget of two.
    expect(h.usageReads).toBe(1);
  });

  it('no allowance at all → nothing released, nothing changed, nothing spent', async () => {
    h.usage['c1:instagram'] = { used: 30, limit: 30, overrideUntil: null };
    h.rows = [banked('p1'), banked('p2')];
    const r = await releaseBankedChanges({ db, logger }, makeQueue());

    expect(r.released).toBe(0);
    expect(r.stillHeld).toBe(2);
    expect(h.added).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it('AN OPERATOR OVERRIDE frees them too — the trigger is allowance, never the 1st', async () => {
    h.usage['c1:instagram'] = { used: 99, limit: 30, overrideUntil: '2026-12-01T00:00:00Z' };
    h.rows = [banked('p1'), banked('p2')];
    const r = await releaseBankedChanges({ db, logger }, makeQueue());
    expect(r.released).toBe(2);
  });

  it('each client+channel gets its own budget', async () => {
    h.usage['c1:instagram'] = { used: 30, limit: 30, overrideUntil: null };   // spent
    h.usage['c2:instagram'] = { used: 0,  limit: 30, overrideUntil: null };   // fresh
    h.rows = [banked('p1'), banked('p2', { clientId: 'c2' })];
    const r = await releaseBankedChanges({ db, logger }, makeQueue());

    expect(r.released).toBe(1);
    expect(h.added[0]!.payload['clientId']).toBe('c2');
    expect(h.usageReads).toBe(2);
  });
});

describe('what the release will not do', () => {
  it('leaves a post alone when a job for it is already in flight', async () => {
    h.rows = [banked('p1')];
    const r = await releaseBankedChanges({ db, logger }, makeQueue({ existingState: 'active' }));
    expect(r.released).toBe(0);
    expect(h.added).toHaveLength(0);
    expect(h.updates).toHaveLength(0);   // the flag stays, so the next pass can settle it
  });

  it('never clears the flag when the enqueue failed — the post stays banked and still says so', async () => {
    h.rows = [banked('p1')];
    const r = await releaseBankedChanges({ db, logger }, makeQueue({ addThrows: true }));
    expect(r.failed).toBe(1);
    expect(r.released).toBe(0);
    expect(h.updates).toHaveLength(0);
  });

  it('one post failing does not end the pass for the rest', async () => {
    h.rows = [banked('p1'), banked('p2')];
    let first = true;
    const queue = {
      getJob: async () => null,
      add: async (name: string, payload: Record<string, unknown>, opts: Record<string, unknown>) => {
        if (first) { first = false; throw new Error('transient'); }
        h.added.push({ name, payload, opts });
      },
    } as never;
    const r = await releaseBankedChanges({ db, logger }, queue);
    expect(r.failed).toBe(1);
    expect(r.released).toBe(1);
  });

  it('an empty pass costs nothing — no usage read, no writes', async () => {
    const r = await releaseBankedChanges({ db, logger }, makeQueue());
    expect(r).toMatchObject({ considered: 0, released: 0, stillHeld: 0 });
    expect(h.usageReads).toBe(0);
  });
});
