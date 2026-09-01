/**
 * billable-attribution.test.ts — whose money a generation spends (0094).
 *
 * ── What went wrong, and what these pin ──────────────────────────────────────────────
 *
 * `readAiChangeUsage` counted every passing post_edits row against the client's monthly
 * allowance, so the plan fan-out spent the allowance on the plan itself. On ivy-t's August
 * the cutoff run wrote 30 rows on top of the 20 she had spent by hand, took her to 50/30, and
 * six days later a time-sensitive promo was refused on quota.
 *
 * The fix is a second field, `billable`, kept deliberately separate from `actor`. These
 * fixtures exist because the OBVIOUS fix — reading `actor` — is wrong in a way that only
 * shows on one path, and a test suite that did not name that path would let it back in.
 *
 * ── The two defaults point opposite ways, and both are asserted ──────────────────────
 *
 *   actor    absent ⇒ 'agent'   under-counts client engagement (0090's own reasoning)
 *   billable absent ⇒ true      CHARGES
 *
 * The second is the load-bearing one. A producer that forgets to mark itself exempt costs the
 * client one change they can see and dispute; the other direction makes the cap unenforceable
 * and announces nothing. Both defaults are pinned below so neither can be "tidied" into
 * agreeing with the other.
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

describe('the caption writer (shape.ts)', () => {
  it('a client-instructed rewrite is billable', async () => {
    await runShapeForCycle(job({ actor: 'client', billable: true }), DEPS);
    expect(h.postEditRows[0]).toMatchObject({ actor: 'client', billable: true });
  });

  it('the plan fan-out writes a row that is NOT billable — the month is the product', async () => {
    await runShapeForCycle(job({ actor: 'agent', billable: false }), DEPS);
    expect(h.postEditRows[0]).toMatchObject({ actor: 'agent', billable: false });
  });

  it('an UNMARKED job is billable — the default charges, so an exemption must be stated', async () => {
    // The direction is the whole point. Defaulting to exempt would mean any future producer
    // that forgot the field silently stopped counting, and the cap would decay without a
    // single failing test or a line in a log.
    await runShapeForCycle(job(), DEPS);
    expect(h.postEditRows[0]).toMatchObject({ billable: true });
  });

  it('billable and actor are INDEPENDENT — agent work can still be the client’s to pay for', async () => {
    // This is the sweep's shape, asserted at the writer: the retry is attributed to the agent
    // because it is not client engagement, and billed to the client because it is her change.
    await runShapeForCycle(job({ actor: 'agent', billable: true }), DEPS);
    expect(h.postEditRows[0]).toMatchObject({ actor: 'agent', billable: true });
  });

  it('the two defaults point opposite ways, and that is deliberate', async () => {
    await runShapeForCycle(job(), DEPS);
    expect(h.postEditRows[0]).toMatchObject({ actor: 'agent', billable: true });
  });
});
