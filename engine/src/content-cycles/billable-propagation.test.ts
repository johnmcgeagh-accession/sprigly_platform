/**
 * billable-propagation.test.ts — the hole `actor` would have opened (0094).
 *
 * ── The named case ───────────────────────────────────────────────────────────────────
 *
 * A CLIENT-instructed change that fails transiently and is retried by the sweep MUST STILL
 * COUNT. This is the one path where "whose hand moved the plan" and "whose money moves" give
 * different answers, and it is the reason the exemption is not keyed on `actor`:
 *
 *   1. the client asks for a rewrite            → job enqueued actor 'client'
 *   2. Bedrock times out, every attempt         → NO post_edits row is written at all,
 *                                                 because the row lands only on success
 *   3. the sweep retries it                     → actor 'agent', deliberately (0090): a
 *                                                 system retry is not client engagement
 *   4. the retry succeeds                       → ONE row, and it is the only row this
 *                                                 change will ever produce
 *
 * Read `actor` at step 4 and the change is free. Do that for every client whose changes ever
 * hit a timeout and the cap stops being a cap. So the sweep reads the POST instead, where the
 * approval fan-out stamped who started the generation and where the fact survives any number
 * of retries.
 *
 * The mirror case is asserted too: a fan-out caption that failed and is swept must NOT become
 * the client's to pay for just because it went round again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as { set: Record<string, unknown> }[],
  added: [] as { name: string; payload: Record<string, unknown>; opts: Record<string, unknown> }[],
  usage: {} as Record<string, { used: number; limit: number; overrideUntil: string | null }>,
}));

vi.mock('@sprigly/db', () => ({
  contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
  contentCycles: new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
  readAiChangeUsage: async (_db: unknown, clientId: string, channel: string) => {
    const u = h.usage[`${clientId}:${channel}`] ?? { used: 0, limit: 30, overrideUntil: null };
    return { ...u, resetsOn: '2026-09-01T00:00:00.000Z', unlimited: false };
  },
}));

// `@sprigly/engine/ai-change-cap` is NOT mocked: `billableForPost` is the derivation under
// test, and a stub of it would be testing the stub. It resolves through the package's own
// export map (dist/), which turbo's `test` → `^build` dependency guarantees is present.

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
    beatSubject: () => null,
    sweepAttemptsOf,
    sweepExhausted: (sm: unknown) => sweepAttemptsOf(sm) >= MAX_SWEEP_ATTEMPTS,
    MAX_SWEEP_ATTEMPTS,
    SWEEP_ATTEMPTS_KEY,
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => ['or', ...a],
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  lt: (a: unknown, b: unknown) => ['lt', a, b],
  isNull: (a: unknown) => ['isNull', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  asc: (a: unknown) => ['asc', a],
  inArray: (a: unknown, b: unknown) => ['inArray', a, b],
  sql: Object.assign((strings: TemplateStringsArray, ...v: unknown[]) => ['sql', strings.join('?'), v], { raw: (s: string) => s }),
}));

vi.mock('./scheduler.js', () => ({ getLondonToday: () => ({ year: 2026, month: 8, day: 28 }) }));
vi.mock('./job-options.js', () => ({ GENERATION_JOB_OPTIONS: { attempts: 3 } }));
vi.mock('./planning.js', () => ({}));

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

function makeQueue() {
  return {
    getJob: async () => null,
    add: async (name: string, payload: Record<string, unknown>, jobOpts: Record<string, unknown>) => {
      h.added.push({ name, payload, opts: jobOpts });
    },
  } as never;
}

import { sweepFailedGenerations } from './generation-sweep.js';
import { releaseBankedChanges } from './banked-changes.js';

beforeEach(() => { h.rows = []; h.updates = []; h.added = []; h.usage = {}; });

describe('THE SWEEP: a client change that failed transiently still counts', () => {
  it('a swept CLIENT rewrite is re-enqueued BILLABLE — actor says agent, the money says client', async () => {
    // The post carries no systemGenerated stamp, because nothing system-generated it: the
    // client asked for this rewrite and the first attempt timed out without writing a row.
    h.rows = [{
      id: 'p1', clientId: 'c1', cycleId: 'cyc1', pillar: 'Everyday Ritual', status: 'generation_failed',
      sourceMeta: { pendingInstruction: 'make it warmer', generationError: 'the request timed out' },
    }];

    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.reenqueued).toBe(1);
    // Attribution is unchanged — our retry is not her engagement (0090).
    expect(h.added[0]!.payload['actor']).toBe('agent');
    // Billing follows the ask. THIS is the assertion that keying on `actor` would break.
    expect(h.added[0]!.payload['billable']).toBe(true);
  });

  it('a swept FAN-OUT caption stays exempt — going round again does not make it hers', async () => {
    h.rows = [{
      id: 'p2', clientId: 'c1', cycleId: 'cyc1', pillar: 'Launch', status: 'generation_failed',
      sourceMeta: { title: 'The Audrey Edit', systemGenerated: true, generationError: 'the request timed out' },
    }];

    const r = await sweepFailedGenerations({ db, logger }, makeQueue());

    expect(r.reenqueued).toBe(1);
    expect(h.added[0]!.payload['actor']).toBe('agent');
    expect(h.added[0]!.payload['billable']).toBe(false);
  });

  it('the stamp is what decides, not the status or the error — both posts are generation_failed', async () => {
    h.rows = [
      { id: 'hers', clientId: 'c1', cycleId: 'cyc1', pillar: 'P', status: 'generation_failed', sourceMeta: { pendingInstruction: 'warmer' } },
      { id: 'ours', clientId: 'c1', cycleId: 'cyc1', pillar: 'P', status: 'generation_failed', sourceMeta: { title: 'T', systemGenerated: true } },
    ];

    await sweepFailedGenerations({ db, logger }, makeQueue());

    const byId = Object.fromEntries(h.added.map((a) => [a.opts['jobId'], a.payload['billable']]));
    expect(byId['shape_cyc1_hers']).toBe(true);
    expect(byId['shape_cyc1_ours']).toBe(false);
  });
});

describe('THE BANKED RELEASE: the client asked for it, so it counts', () => {
  it('a released banked post is billable — banking only ever happens on the client-ask path', async () => {
    h.rows = [{
      id: 'p1', clientId: 'c1', cycleId: 'cyc1', channel: 'instagram', pillar: 'Launch',
      sourceMeta: { quotaBanked: true, quotaBankedAt: '2026-08-30T15:05:17.946Z', pendingInstruction: 'our end of summer treat' },
    }];

    const r = await releaseBankedChanges({ db, logger }, makeQueue());

    expect(r.released).toBe(1);
    expect(h.added[0]!.payload['actor']).toBe('client');
    expect(h.added[0]!.payload['billable']).toBe(true);
  });

  it('and it reads the post through the SAME helper the sweep uses, so the two cannot drift', async () => {
    // Defensive: a banked post that somehow carried the fan-out stamp must get the same
    // answer here as it would in the sweep. One derivation, one answer about one client's money.
    h.rows = [{
      id: 'p1', clientId: 'c1', cycleId: 'cyc1', channel: 'instagram', pillar: 'Launch',
      sourceMeta: { quotaBanked: true, quotaBankedAt: '2026-08-30T15:05:17.946Z', pendingInstruction: 'x', systemGenerated: true },
    }];

    await releaseBankedChanges({ db, logger }, makeQueue());

    expect(h.added[0]!.payload['billable']).toBe(false);
  });
});
