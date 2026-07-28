/**
 * actor-attribution.test.ts — the worker records whose intent it is acting on (0090).
 *
 * By the time a shape job runs, the session that caused it is gone. So the enqueuer states
 * the actor on the payload and the worker records what it was told — the two rows it writes
 * (post_edits and plan_activity) must agree, and both must default the same way.
 *
 * The default direction is the load-bearing assertion. An unattributed job resolves to
 * 'agent', which UNDER-counts client engagement. The other default would inflate the exact
 * number the column exists to measure honestly, and would do it silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  post: null as Record<string, unknown> | null,
  cycle: { id: 'cyc-1', clientId: 'client-1', channel: 'instagram', cycleMonth: '2026-09' },
  postEditRows: [] as Record<string, unknown>[],
  ledgerRows: [] as Record<string, unknown>[],
  selectCall: 0,
}));

vi.mock('@sprigly/db', () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    q['from']  = vi.fn(() => q);
    q['where'] = vi.fn(() => q);
    q['limit'] = vi.fn(() => Promise.resolve((q['__rows'] as unknown[]) ?? []));
    return q;
  };
  return {
    db: {
      select: vi.fn(() => {
        const q = chain();
        q['__rows'] = h.selectCall++ === 0 ? [h.cycle] : [h.post];
        q['limit'] = vi.fn(() => Promise.resolve(q['__rows'] as unknown[]));
        return q;
      }),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
      insert: vi.fn(() => ({ values: vi.fn((v: Record<string, unknown>) => { h.postEditRows.push(v); return Promise.resolve(); }) })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    contentCycles:     new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
    contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
    postEdits:         new Proxy({}, { get: (_t, k) => `postEdits.${String(k)}` }),
  };
});

vi.mock('drizzle-orm', () => ({ and: (...a: unknown[]) => a, eq: (a: unknown, b: unknown) => ['eq', a, b] }));

vi.mock('./planning.js', () => ({
  assembleShapeContext: async () => ({
    vocab: { categories: [], pillars: [] }, systemPrompt: 's', userMessage: 'u',
    criticPrompt: 'c', voiceMd: null, planConfigRow: undefined, historicPosts: [], voiceEdits: [],
    catalogue: null, structuredBrief: null, clientName: 'Test',
  }),
}));

vi.mock('./plan-validation.js', () => ({
  regeneratePost: async () => ({ draftCaption: 'a rewritten caption' }),
  applyCodeGate: async (rows: unknown[]) => ({ rows, acceptedWithWarning: [] }),
  applyCritic:   async (rows: unknown[]) => ({ rows, acceptedWithWarning: [] }),
}));

vi.mock('./ledger.js', () => ({
  recordPlanActivity: async (_db: unknown, entry: Record<string, unknown>) => { h.ledgerRows.push(entry); },
}));

vi.mock('../catalogue/validate-catalogue.js', () => ({
  indexCatalogue: () => ({}),
  applyCatalogueValidation: (c: string) => ({ caption: c, notes: [], violations: [] }),
  deriveBrandTokens: () => new Set<string>(),
}));

import { runShapeForCycle } from './shape.js';
import { db as mockDb } from '@sprigly/db';

const DEPS = { db: mockDb, model: {}, audit: {}, logger: { info() {}, warn() {} } } as never;
const job = (over: Record<string, unknown> = {}) => ({
  type: 'shape' as const, scope: 'post' as const, clientId: 'client-1', cycleId: 'cyc-1',
  targetPostId: 'p1', instruction: 'make it warmer', source: 'web' as const, ...over,
}) as never;

beforeEach(() => {
  h.postEditRows = [];
  h.ledgerRows = [];
  h.selectCall = 0;
  h.post = { id: 'p1', status: 'planned', caption: 'before', pillar: 'Everyday Ritual', format: 'carousel', scheduledDate: '2026-09-02', sourceMeta: {} };
});

describe('a client-instructed rewrite', () => {
  it('records the client on the audit row', async () => {
    await runShapeForCycle(job({ actor: 'client' }), DEPS);
    expect(h.postEditRows[0]).toMatchObject({ actor: 'client' });
  });

  it('records the client on the ledger row too — origin stays agent, because the agent wrote it', async () => {
    await runShapeForCycle(job({ actor: 'client' }), DEPS);
    expect(h.ledgerRows[0]!['actor']).toMatchObject({ origin: 'agent', actor: 'client' });
  });

  it('says the same thing in both places', async () => {
    await runShapeForCycle(job({ actor: 'client' }), DEPS);
    expect(h.postEditRows[0]!['actor']).toBe((h.ledgerRows[0]!['actor'] as Record<string, unknown>)['actor']);
  });
});

describe('generation nobody asked for in the moment', () => {
  it('the fan-out’s own jobs record the agent', async () => {
    await runShapeForCycle(job({ actor: 'agent' }), DEPS);
    expect(h.postEditRows[0]).toMatchObject({ actor: 'agent' });
    expect(h.ledgerRows[0]!['actor']).toMatchObject({ actor: 'agent' });
  });

  it('an UNATTRIBUTED job defaults to agent, never to client', async () => {
    // The direction is the point. Defaulting the other way would count our own retries and
    // fan-outs as client engagement, inflating the one number this column measures.
    await runShapeForCycle(job(), DEPS);
    expect(h.postEditRows[0]).toMatchObject({ actor: 'agent' });
    expect(h.ledgerRows[0]!['actor']).toMatchObject({ actor: 'agent' });
  });
});
