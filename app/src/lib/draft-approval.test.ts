/**
 * draft-approval.test.ts — the one door that spends money.
 *
 * The guards matter more than the happy path: approval flips a whole month into
 * generation, and the failure modes are a half-approved month, a double charge, or a
 * client's committed plan being overwritten.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let results: unknown[][] = [];
const writes: { kind: string; payload?: unknown; where?: unknown }[] = [];

vi.mock('@sprigly/db', () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    q['from']    = vi.fn(() => q);
    q['where']   = vi.fn(() => q);
    q['orderBy'] = vi.fn(() => Promise.resolve(results.shift() ?? []));
    q['limit']   = vi.fn(() => Promise.resolve(results.shift() ?? []));
    q['then']    = (res: (v: unknown) => unknown) => res(results.shift() ?? []);
    return q;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select: vi.fn(() => chain()),
    update: vi.fn(() => ({ set: vi.fn((payload: unknown) => ({ where: vi.fn((where: unknown) => { writes.push({ kind: 'update', payload, where }); return Promise.resolve(); }) })) })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return {
    db,
    contentCycles:     new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
    contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
    POST_STATUS_DRAFT: 'draft',
    PRE_PLANNING_STATUSES: new Set(['scheduled', 'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed']),
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a, eq: (a: unknown, b: unknown) => ['eq', a, b],
  ne: (a: unknown, b: unknown) => ['ne', a, b], isNull: (a: unknown) => ['isNull', a],
  gte: (a: unknown, b: unknown) => ['gte', a, b], sql: Object.assign(() => 'sql', { raw: () => 'sql' }),
}));

import { approveDraft, POST_STATUS_GENERATING } from '@/lib/draft-approval';

const CLIENT = 'client-1', CYCLE = 'cycle-1';
const preCutoffCycle = [{ id: CYCLE, status: 'scheduled', approvedAt: null }];
const threeDrafts = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
const noCommitted: unknown[] = [];

beforeEach(() => { results = []; writes.length = 0; });

describe('approveDraft — happy path', () => {
  it('transitions every draft to the status the SHIPPED generation path expects', async () => {
    results = [preCutoffCycle, threeDrafts, noCommitted];
    const res = await approveDraft({ clientId: CLIENT, cycleId: CYCLE });
    expect(res).toMatchObject({ ok: true, approved: 3 });
    // 'generating' is not invented here — it is what addGeneratingPost inserts and what
    // shape.ts resolves to 'new' / 'generation_failed'.
    expect(POST_STATUS_GENERATING).toBe('generating');
    expect(writes[0]).toMatchObject({ kind: 'update', payload: { status: 'generating' } });
  });

  it('stamps the cycle as client-approved', async () => {
    results = [preCutoffCycle, threeDrafts, noCommitted];
    await approveDraft({ clientId: CLIENT, cycleId: CYCLE });
    expect(writes[1]!.payload).toMatchObject({ approvedBy: 'client', approvedAt: expect.any(Date) });
  });

  it('stamps AUTO approval distinctly — never claim the client chose when they did not', async () => {
    results = [preCutoffCycle, threeDrafts, noCommitted];
    await approveDraft({ clientId: CLIENT, cycleId: CYCLE, auto: true });
    expect(writes[1]!.payload).toMatchObject({ approvedBy: 'auto' });
  });

  it('returns the ids so the fan-out knows exactly what it approved', async () => {
    results = [preCutoffCycle, threeDrafts, noCommitted];
    const res = await approveDraft({ clientId: CLIENT, cycleId: CYCLE });
    expect(res.ok && res.postIds).toEqual(['b1', 'b2', 'b3']);
  });

  it('is ATOMIC — both writes happen inside ONE transaction', async () => {
    results = [preCutoffCycle, threeDrafts, noCommitted];
    const { db } = await import('@sprigly/db');
    const tx = (db as unknown as { transaction: { mock: { calls: unknown[] } } }).transaction;
    const before = tx.mock.calls.length;
    await approveDraft({ clientId: CLIENT, cycleId: CYCLE });
    // A half-approved month — some beats generating, some still draft — is a state no
    // reader in the system can render honestly. Both writes, one transaction.
    expect(tx.mock.calls.length - before).toBe(1);
    expect(writes).toHaveLength(2);
  });

  it('re-checks status=draft INSIDE the write, not just in the preceding read', async () => {
    results = [preCutoffCycle, threeDrafts, noCommitted];
    await approveDraft({ clientId: CLIENT, cycleId: CYCLE });
    const where = JSON.stringify(writes[0]!.where);
    expect(where).toContain('draft');
  });
});

describe('approveDraft — guards', () => {
  it('refuses a cycle that is not this client’s', async () => {
    results = [[]];
    expect(await approveDraft({ clientId: CLIENT, cycleId: CYCLE })).toMatchObject({ ok: false, error: 'no_cycle' });
    expect(writes).toHaveLength(0);
  });

  it('refuses when there is no draft', async () => {
    results = [preCutoffCycle, []];
    expect(await approveDraft({ clientId: CLIENT, cycleId: CYCLE })).toMatchObject({ ok: false, error: 'no_draft' });
    expect(writes).toHaveLength(0);
  });

  it('refuses MIXED STATE — a month with committed posts is not a draft to approve', async () => {
    results = [preCutoffCycle, threeDrafts, [{ id: 'committed-1' }]];
    expect(await approveDraft({ clientId: CLIENT, cycleId: CYCLE })).toMatchObject({ ok: false, error: 'mixed_state' });
    expect(writes).toHaveLength(0);
  });

  it('DOUBLE APPROVE is rejected, not silently repeated', async () => {
    // Chosen over idempotent-by-no-op because approval SPENDS MONEY: a quiet success would
    // be indistinguishable from a second fan-out, and paying twice is worse than an
    // explicit "already approved".
    results = [[{ id: CYCLE, status: 'scheduled', approvedAt: new Date('2026-08-01') }]];
    const res = await approveDraft({ clientId: CLIENT, cycleId: CYCLE });
    expect(res).toMatchObject({ ok: false, error: 'already_approved' });
    expect(res.ok === false && res.message).toMatch(/already approved/i);
    expect(writes).toHaveLength(0);
  });

  it('refuses MANUAL approval past the cutoff', async () => {
    results = [[{ id: CYCLE, status: 'workbook_built', approvedAt: null }]];
    expect(await approveDraft({ clientId: CLIENT, cycleId: CYCLE })).toMatchObject({ ok: false, error: 'cutoff_passed' });
    expect(writes).toHaveLength(0);
  });

  it('AUTO approval bypasses the cutoff guard — being at cutoff is its whole trigger', async () => {
    results = [[{ id: CYCLE, status: 'intake_confirmed', approvedAt: null }], threeDrafts, noCommitted];
    expect(await approveDraft({ clientId: CLIENT, cycleId: CYCLE, auto: true })).toMatchObject({ ok: true, approved: 3 });
  });

  it('auto approval still refuses a DOUBLE approve', async () => {
    results = [[{ id: CYCLE, status: 'scheduled', approvedAt: new Date() }]];
    expect(await approveDraft({ clientId: CLIENT, cycleId: CYCLE, auto: true })).toMatchObject({ ok: false, error: 'already_approved' });
  });
});
