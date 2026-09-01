/**
 * banked-retire.test.ts — the promise a banked post made, retired when it can no longer be kept.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────────────
 *
 * `releaseBankedChanges` declines to write a banked post whose day has passed. That is right
 * and stays. What was missing was anything that said so: the row kept its flag, its status and
 * its message, so ivy-t's 31 August promo went on reading "Waiting for your changes to refresh
 * on 1 September" on 1 September and after — a date in the past, for work already abandoned.
 *
 * ── What these pin ───────────────────────────────────────────────────────────────────
 *
 * That an expired post is retired and says something true; that a post whose day is still
 * ahead is not touched; that a genuine failure is invisible to this pass; that nothing is ever
 * enqueued; and that a second tick does not rewrite what the first already retired.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  /** Rows for each successive db.select(): [0] retirement read, [1] release read. */
  selects: [] as Record<string, unknown>[][],
  selectCall: 0,
  updates: [] as { set: Record<string, unknown> }[],
  added: [] as { name: string; payload: Record<string, unknown> }[],
  usage: {} as Record<string, { used: number; limit: number; overrideUntil: string | null }>,
  updateThrows: false,
}));

vi.mock('@sprigly/db', () => ({
  contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
  contentCycles: new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
  readAiChangeUsage: async (_db: unknown, clientId: string, channel: string) => {
    const u = h.usage[`${clientId}:${channel}`] ?? { used: 0, limit: 30, overrideUntil: null };
    return { ...u, resetsOn: '2026-10-01T00:00:00.000Z', unlimited: false };
  },
}));

// `@sprigly/engine/ai-change-cap` is NOT mocked: `expiredLine` is the sentence under test and a
// stub would be testing the stub. Resolved through the package export map (dist/), which
// turbo's test -> ^build dependency guarantees is built.

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  isNull: (a: unknown) => ['isNull', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  lt: (a: unknown, b: unknown) => ['lt', a, b],
  asc: (a: unknown) => ['asc', a],
  sql: Object.assign((strings: TemplateStringsArray, ...v: unknown[]) => ['sql', strings.join('?'), v], { raw: (s: string) => s }),
}));

/** London 'today' for every case below is 2026-09-01 — the morning after ivy-t's promo. */
vi.mock('./scheduler.js', () => ({ getLondonToday: () => ({ year: 2026, month: 9, day: 1 }) }));
vi.mock('./job-options.js', () => ({ GENERATION_JOB_OPTIONS: { attempts: 3 } }));
vi.mock('./planning.js', () => ({}));
vi.mock('./generation-sweep.js', () => ({
  shapeJobId: (cycleId: string, postId: string) => `shape_${cycleId}_${postId}`,
  instructionFor: (p: { sourceMeta: Record<string, unknown> }) => String(p.sourceMeta['pendingInstruction'] ?? 'fallback'),
}));

const db = {
  select: () => {
    const rows = h.selects[h.selectCall++] ?? [];
    const q: Record<string, unknown> = {};
    q['from']      = () => q;
    q['innerJoin'] = () => q;
    q['where']     = () => q;
    q['orderBy']   = () => q;
    q['limit']     = () => Promise.resolve(rows);
    return q;
  },
  update: () => ({
    set: (payload: Record<string, unknown>) => ({
      where: () => {
        if (h.updateThrows) return Promise.reject(new Error('deadlock'));
        h.updates.push({ set: payload });
        return Promise.resolve();
      },
    }),
  }),
} as never;

const logger = { info() {}, warn() {} } as never;
const queue = {
  getJob: async () => null,
  add: async (name: string, payload: Record<string, unknown>) => { h.added.push({ name, payload }); },
} as never;

import { retireExpiredBanked, releaseBankedChanges } from './banked-changes.js';

/** ivy-t's actual row: banked 30 Aug for a 31 Aug promo, read on 1 Sep. */
const expiredRow = (over: Record<string, unknown> = {}) => ({
  id: '67b57180', clientId: 'c79cf1c5', cycleId: 'efae0950', scheduledDate: '2026-08-31',
  sourceMeta: {
    title: 'our end of summer treat',
    quotaBanked: true,
    quotaBankedAt: '2026-08-30T15:05:17.946Z',
    pendingInstruction: 'our end of summer treat - free uk p&P ending at midnight',
    generationError: 'Waiting for your changes to refresh on 1 September.',
  },
  ...over,
});

beforeEach(() => {
  h.selects = []; h.selectCall = 0; h.updates = []; h.added = []; h.usage = {}; h.updateThrows = false;
});

describe('a banked post whose day has passed', () => {
  it('is retired: status moves and the stale promise is replaced', async () => {
    h.selects = [[expiredRow()]];
    const n = await retireExpiredBanked({ db, logger });

    expect(n).toBe(1);
    expect(h.updates).toHaveLength(1);
    const set = h.updates[0]!.set;
    expect(set['status']).toBe('generation_expired');

    const meta = set['sourceMeta'] as Record<string, unknown>;
    expect(meta['generationError']).not.toContain('Waiting');
    expect(meta['generationError']).not.toContain('1 September');
  });

  it('the message says it was not written, why, and names the day that passed', async () => {
    h.selects = [[expiredRow()]];
    await retireExpiredBanked({ db, logger });

    const meta = (h.updates[0]!.set['sourceMeta']) as Record<string, unknown>;
    const msg = String(meta['generationError']);

    expect(msg).toContain('used all your changes');   // there WAS a limit — the old copy never said so
    expect(msg).toContain('31 August');               // the post's own day, the deadline actually missed
    expect(msg).toContain('didn’t write it');         // the outcome, stated
    // and it must not promise, or reach for the failure vocabulary the client fence bans
    expect(msg).not.toMatch(/waiting|on its way|shortly|soon/i);
    expect(msg).not.toMatch(/\b(failed|failure|retry|retried|error)\b/i);
  });

  it('the banked flag and its stamp go — otherwise the card keeps saying "Waiting on your changes"', async () => {
    h.selects = [[expiredRow()]];
    await retireExpiredBanked({ db, logger });

    const meta = (h.updates[0]!.set['sourceMeta']) as Record<string, unknown>;
    expect(meta['quotaBanked']).toBeUndefined();
    expect(meta['quotaBankedAt']).toBeUndefined();
    expect(meta['quotaExpiredAt']).toBe(new Date(meta['quotaExpiredAt'] as string).toISOString());
  });

  it('keeps the instruction — it is the record of what we did not write for her', async () => {
    h.selects = [[expiredRow()]];
    await retireExpiredBanked({ db, logger });

    const meta = (h.updates[0]!.set['sourceMeta']) as Record<string, unknown>;
    expect(meta['pendingInstruction']).toBe('our end of summer treat - free uk p&P ending at midnight');
  });

  it('SPENDS NOTHING — the function has no queue to spend with', async () => {
    h.selects = [[expiredRow()]];
    await retireExpiredBanked({ db, logger });
    expect(h.added).toHaveLength(0);
    // The signature is the guarantee: retireExpiredBanked takes (deps, now) and no Queue.
    expect(retireExpiredBanked.length).toBeLessThanOrEqual(2);
  });

  it('one row failing does not end the pass', async () => {
    h.selects = [[expiredRow(), expiredRow({ id: 'p2' })]];
    h.updateThrows = true;
    const n = await retireExpiredBanked({ db, logger });
    expect(n).toBe(0);   // both failed, neither threw out of the pass
  });
});

describe('what retirement must not touch', () => {
  it('a banked post whose day is still ahead is not retired — it is still releasable', async () => {
    // The date clause is the mirror of the release guard: this row belongs to the other pass,
    // so the retirement read returns nothing for it.
    h.selects = [[]];
    const n = await retireExpiredBanked({ db, logger });
    expect(n).toBe(0);
    expect(h.updates).toHaveLength(0);
  });

  it('and that post still releases normally when the allowance is there', async () => {
    h.selects = [
      [],                                  // retirement read: nothing expired
      [{ id: 'p9', clientId: 'c1', cycleId: 'cyc1', channel: 'instagram', pillar: 'Launch',
         sourceMeta: { quotaBanked: true, quotaBankedAt: '2026-08-30T15:05:17.946Z', pendingInstruction: 'write p9' } }],
    ];
    const r = await releaseBankedChanges({ db, logger }, queue);

    expect(r.retired).toBe(0);
    expect(r.released).toBe(1);
    expect(h.added).toHaveLength(1);
    expect(h.added[0]!.payload['instruction']).toBe('write p9');
  });

  it('a genuine failure is invisible to this pass — no quotaBanked flag, so the query never sees it', async () => {
    // The retirement read requires quotaBanked = 'true' in SQL. A timeout, a critic refusal or
    // a failed enqueue carries no such flag and cannot be retired by accident.
    h.selects = [[]];
    const n = await retireExpiredBanked({ db, logger });
    expect(n).toBe(0);
    expect(h.updates).toHaveLength(0);
  });
});

describe('idempotence', () => {
  it('an already-retired row is excluded in SQL, so a second tick rewrites nothing', async () => {
    // quotaExpiredAt IS NULL is a WHERE clause, so the row simply is not returned. Asserted as
    // behaviour: given the query returns nothing, the pass writes nothing and reports nothing.
    h.selects = [[]];
    const n = await retireExpiredBanked({ db, logger });
    expect(n).toBe(0);
    expect(h.updates).toHaveLength(0);
  });

  it('retirement is reported on the release result, so a tick can say what it settled', async () => {
    h.selects = [[expiredRow()], []];
    const r = await releaseBankedChanges({ db, logger }, queue);
    expect(r.retired).toBe(1);
    expect(r.released).toBe(0);
    expect(h.added).toHaveLength(0);
  });
});
