/**
 * shape-retry.test.ts — bounded retry on generation jobs.
 *
 * Build D observed 1-in-10 first-pass Bedrock TIMEOUTS with attempts:1, so a transient
 * failure became a client-visible generation_failed the client had to notice and fix.
 * These pin the two halves of the correction: a recoverable failure must not surface, and
 * an unrecoverable one still must.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  post: null as Record<string, unknown> | null,
  cycle: { id: 'cyc-1', clientId: 'client-1', channel: 'instagram', cycleMonth: '2026-09' },
  regenerate: vi.fn(),
  updates: [] as Record<string, unknown>[],
  // Which select() call we are on WITHIN one runShapeForCycle. Reset per test, so the
  // cycle/post alternation cannot drift across cases.
  selectCall: 0,
}));

vi.mock('@sprigly/db', () => {
  const chain = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    q['from']  = vi.fn(() => q);
    q['where'] = vi.fn(() => q);
    q['limit'] = vi.fn(() => Promise.resolve(q['__rows'] as unknown[] ?? []));
    return q;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: {
      select: vi.fn(() => {
        const q = chain();
        // 1st select = cycle, 2nd = post.
        q['__rows'] = h.selectCall++ === 0 ? [h.cycle] : [h.post];
        q['limit'] = vi.fn(() => Promise.resolve(q['__rows'] as unknown[]));
        return q;
      }),
      update: vi.fn(() => ({ set: vi.fn((payload: Record<string, unknown>) => ({ where: vi.fn(() => { h.updates.push(payload); return Promise.resolve(); }) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    } as any,
    contentCycles:     new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
    contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
    postEdits:         new Proxy({}, { get: (_t, k) => `postEdits.${String(k)}` }),
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a, eq: (a: unknown, b: unknown) => ['eq', a, b],
}));

vi.mock('./planning.js', () => ({
  assembleShapeContext: async () => ({
    vocab: { categories: [], pillars: [] }, systemPrompt: 's', userMessage: 'u',
    criticPrompt: 'c', voiceMd: null, planConfigRow: undefined, historicPosts: [], voiceEdits: [],
    catalogue: null, structuredBrief: null, clientName: 'Test',
  }),
}));

vi.mock('./plan-validation.js', () => ({
  regeneratePost: (...a: unknown[]) => h.regenerate(...a),
  applyCodeGate: async (rows: unknown[]) => ({ rows, acceptedWithWarning: [] }),
  applyCritic:   async (rows: unknown[]) => ({ rows, acceptedWithWarning: [] }),
}));

vi.mock('./ledger.js', () => ({ recordPlanActivity: async () => {} }));
vi.mock('../catalogue/validate-catalogue.js', () => ({
  indexCatalogue: () => ({}), applyCatalogueValidation: (c: string) => ({ caption: c, notes: [], violations: [] }),
  deriveBrandTokens: () => new Set<string>(),
}));

import { runShapeForCycle } from './shape.js';
import { db as mockDb } from '@sprigly/db';

const JOB = { type: 'shape' as const, scope: 'post' as const, clientId: 'client-1', cycleId: 'cyc-1', targetPostId: 'p1', instruction: 'write it', source: 'web' as const };
const DEPS = { db: mockDb, model: {}, audit: {}, logger: { info() {}, warn() {} } } as never;

beforeEach(() => {
  h.updates = [];
  h.selectCall = 0;
  h.regenerate.mockReset();
  h.post = { id: 'p1', status: 'generating', caption: '', pillar: 'Everyday Ritual', format: 'carousel', scheduledDate: '2026-09-02', sourceMeta: {} };
});

describe('a recoverable failure does not surface to the client', () => {
  it('a NON-final attempt failing does NOT stamp generation_failed', async () => {
    // The failure BullMQ is about to retry is not a failure the client should be looking at.
    h.regenerate.mockRejectedValue(new Error('Bedrock request timed out after 180s'));
    await expect(runShapeForCycle(JOB, DEPS, false)).rejects.toThrow(/timed out/);
    expect(h.updates.some((u) => u['status'] === 'generation_failed')).toBe(false);
  });

  it('rethrows so BullMQ actually retries it', async () => {
    h.regenerate.mockRejectedValue(new Error('Bedrock request timed out after 180s'));
    await expect(runShapeForCycle(JOB, DEPS, false)).rejects.toThrow();
  });

  it('a retry that SUCCEEDS resolves the post to new, not edited', async () => {
    // The row may read 'generation_failed' from an earlier manual retry. It is still
    // finishing the original generation, so success must be 'new'.
    h.post = { ...h.post!, status: 'generation_failed' };
    h.regenerate.mockResolvedValue({ draftCaption: 'A recovered caption.' });
    await runShapeForCycle(JOB, DEPS, true);
    expect(h.updates[0]).toMatchObject({ caption: 'A recovered caption.', status: 'new' });
  });
});

describe('an unrecoverable failure still surfaces — the backstop is not weakened', () => {
  it('the FINAL attempt failing stamps generation_failed with the reason', async () => {
    h.regenerate.mockRejectedValue(new Error('Bedrock request timed out after 180s'));
    await expect(runShapeForCycle(JOB, DEPS, true)).rejects.toThrow();
    const failed = h.updates.find((u) => u['status'] === 'generation_failed');
    expect(failed).toBeDefined();
    expect(JSON.stringify(failed)).toContain('timed out');
  });

  it('defaults to final-attempt behaviour, so every existing caller is unchanged', async () => {
    h.regenerate.mockRejectedValue(new Error('boom'));
    await expect(runShapeForCycle(JOB, DEPS)).rejects.toThrow();
    expect(h.updates.some((u) => u['status'] === 'generation_failed')).toBe(true);
  });
});

describe('the happy path is untouched', () => {
  it('writes the caption and resolves a generating post to new', async () => {
    h.regenerate.mockResolvedValue({ draftCaption: 'A fresh caption.' });
    const res = await runShapeForCycle(JOB, DEPS, true);
    expect(res.changedPostIds).toEqual(['p1']);
    expect(h.updates[0]).toMatchObject({ caption: 'A fresh caption.', status: 'new' });
  });

  it('a direct rewrite of a committed post still resolves to edited', async () => {
    h.post = { ...h.post!, status: 'planned', caption: 'old' };
    h.regenerate.mockResolvedValue({ draftCaption: 'A reshaped caption.' });
    await runShapeForCycle(JOB, DEPS, true);
    expect(h.updates[0]).toMatchObject({ status: 'edited' });
  });
});
