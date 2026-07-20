/**
 * draft-reader.test.ts — the ONE deliberate draft reader, and the readability decision.
 *
 * Build A fenced drafts out of every reader. Build B opens exactly one door:
 * loadDraftBeats. These tests pin both halves — that the door opens onto drafts and only
 * drafts, and that the readability predicate is an explicit OR rather than a loosened
 * fence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const DRAFT_FENCE = Symbol('excludeDraftPosts');

/** Terminal query results, consumed in call order. */
let results: unknown[][] = [];
const captured: { where: unknown[]; joins: unknown[] } = { where: [], joins: [] };

vi.mock('@sprigly/db', () => {
  const chain = () => {
    const q: Record<string, unknown> = {};
    q['from']     = vi.fn(() => q);
    q['leftJoin'] = vi.fn((_t: unknown, cond: unknown) => { captured.joins.push(cond); return q; });
    q['where']    = vi.fn((cond: unknown) => { captured.where.push(cond); return q; });
    // Terminal methods resolve the next queued result.
    q['orderBy']  = vi.fn(() => Promise.resolve(results.shift() ?? []));
    q['groupBy']  = vi.fn(() => Promise.resolve(results.shift() ?? []));
    q['limit']    = vi.fn(() => Promise.resolve(results.shift() ?? []));
    return q;
  };
  return {
    db: { select: vi.fn(() => chain()) },
    contentCycles:     new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
    contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
    excludeDraftPosts: () => DRAFT_FENCE,
    POST_STATUS_DRAFT: 'draft',
    PRE_PLANNING_STATUSES: new Set(['scheduled']),
  };
});

vi.mock('drizzle-orm', () => ({
  and:    (...args: unknown[]) => args,
  eq:     (a: unknown, b: unknown) => ['eq', a, b],
  ne:     (a: unknown, b: unknown) => ['ne', a, b],
  asc:    (a: unknown) => ['asc', a],
  desc:   (a: unknown) => ['desc', a],
  gte:    (a: unknown, b: unknown) => ['gte', a, b],
  lt:     (a: unknown, b: unknown) => ['lt', a, b],
  isNull: (a: unknown) => ['isNull', a],
  sql:    Object.assign(() => 'sql', { raw: () => 'sql' }),
}));

vi.mock('@/lib/steps', () => ({ listStepsForPosts: () => Promise.resolve(new Map()) }));

/** Deep search for a value inside a nested condition array. */
function contains(node: unknown, needle: unknown): boolean {
  if (node === needle) return true;
  if (Array.isArray(node)) return node.some((n) => contains(n, needle));
  return false;
}
/** Deep search for an eq(column, value) pair. */
function hasEq(node: unknown, column: string, value: unknown): boolean {
  if (Array.isArray(node)) {
    if (node[0] === 'eq' && node[1] === column && node[2] === value) return true;
    return node.some((n) => hasEq(n, column, value));
  }
  return false;
}

const draftRow = (over: Record<string, unknown> = {}) => ({
  id: 'beat-1', cycleId: 'cycle-1', clientId: 'client-1', channel: 'instagram',
  scheduledDate: '2026-09-02', format: 'carousel', pillar: 'Brand Story & Culture',
  caption: null, status: 'draft', position: 0, deletedAt: null, reviewState: null,
  hook: null, script: null, scriptLengthSeconds: null, overlay: null,
  sourceMeta: { title: 'Brand Story & Culture — Carousel' },
  beatMeta: {
    slotType: 'proven',
    rationaleEvidence: {
      basis: 'observed',
      formatEngagement: { format: 'carousel', avgEngagement: 69.9, posts: 8 },
      pillarShare: 0.2,
      cadenceBasis: { postsPerWeek: 2.24, source: 'observed', months: 4 },
    },
    assumptions: ['No launches or restocks are on record for this month.'],
  },
  ...over,
});

beforeEach(() => { results = []; captured.where = []; captured.joins = []; });

describe('loadDraftBeats — drafts, and ONLY drafts', () => {
  it('filters to status=draft, scoped to the client and cycle', async () => {
    results = [[draftRow()]];
    const { loadDraftBeats } = await import('@/lib/plan');
    await loadDraftBeats('client-1', 'cycle-1');

    const where = captured.where[0];
    expect(hasEq(where, 'contentCyclePosts.status', 'draft')).toBe(true);
    expect(hasEq(where, 'contentCyclePosts.cycleId', 'cycle-1')).toBe(true);
    expect(hasEq(where, 'contentCyclePosts.clientId', 'client-1')).toBe(true);
    // It must NOT apply the fence — this is the one reader that inverts it.
    expect(contains(where, DRAFT_FENCE)).toBe(false);
  });

  it('surfaces beat_meta: slotType, evidence and assumptions', async () => {
    results = [[draftRow()]];
    const { loadDraftBeats } = await import('@/lib/plan');
    const [beat] = await loadDraftBeats('client-1', 'cycle-1');

    expect(beat!.id).toBe('beat-1');
    expect(beat!.date).toBe('2026-09-02');
    expect(beat!.format).toBe('carousel');
    expect(beat!.title).toBe('Brand Story & Culture — Carousel');
    expect(beat!.slotType).toBe('proven');
    expect(beat!.evidence.basis).toBe('observed');
    expect(beat!.evidence.formatEngagement).toEqual({ format: 'carousel', avgEngagement: 69.9, posts: 8 });
    expect(beat!.assumptions).toHaveLength(1);
  });

  it('marks an experiment beat', async () => {
    results = [[draftRow({ beatMeta: { slotType: 'experiment', rationaleEvidence: { basis: 'observed' } } })]];
    const { loadDraftBeats } = await import('@/lib/plan');
    const [beat] = await loadDraftBeats('client-1', 'cycle-1');
    expect(beat!.slotType).toBe('experiment');
  });

  it('renders an honest unexplained beat when beat_meta is missing, rather than throwing', async () => {
    // A row written before the column existed, or by hand. It must not fabricate a
    // rationale and must not take the surface down.
    results = [[draftRow({ beatMeta: null, sourceMeta: null })]];
    const { loadDraftBeats } = await import('@/lib/plan');
    const [beat] = await loadDraftBeats('client-1', 'cycle-1');
    expect(beat!.slotType).toBe('proven');
    expect(beat!.evidence.basis).toBe('template');
    expect(beat!.assumptions).toEqual([]);
    expect(beat!.title).toBe('Brand Story & Culture');   // falls back to the pillar, never blank
  });

  it('returns [] for a cycle with no drafts', async () => {
    results = [[]];
    const { loadDraftBeats } = await import('@/lib/plan');
    expect(await loadDraftBeats('client-1', 'cycle-1')).toEqual([]);
  });
});

describe('isCycleReadableByClient — committed posts OR a reviewable draft', () => {
  it('a cycle with committed posts is readable (unchanged behaviour)', async () => {
    results = [[{ syncStatus: 'synced', liveCount: 12 }]];
    const { isCycleReadableByClient } = await import('@/lib/plan');
    expect(await isCycleReadableByClient('client-1', 'cycle-1')).toBe(true);
    // The committed-post count keeps Build A's fence — drafts still do not count as plan.
    expect(captured.joins.some((j) => contains(j, DRAFT_FENCE))).toBe(true);
  });

  it('a DRAFT-ONLY cycle is now readable, via the explicit predicate', async () => {
    results = [
      [{ syncStatus: null, liveCount: 0 }],   // no committed posts
      [{ id: 'beat-1' }],                     // …but a draft exists
    ];
    const { isCycleReadableByClient } = await import('@/lib/plan');
    expect(await isCycleReadableByClient('client-1', 'cycle-1')).toBe(true);
  });

  it('an EMPTY cycle — no posts, no drafts — is still unreadable', async () => {
    results = [
      [{ syncStatus: null, liveCount: 0 }],
      [],                                     // no drafts either
    ];
    const { isCycleReadableByClient } = await import('@/lib/plan');
    expect(await isCycleReadableByClient('client-1', 'cycle-1')).toBe(false);
  });

  it('an out_of_sync cycle stays unreadable even if it holds drafts', async () => {
    results = [[{ syncStatus: 'out_of_sync', liveCount: 5 }]];
    const { isCycleReadableByClient } = await import('@/lib/plan');
    expect(await isCycleReadableByClient('client-1', 'cycle-1')).toBe(false);
  });

  it("another client's cycle is unreadable (no row)", async () => {
    results = [[]];
    const { isCycleReadableByClient } = await import('@/lib/plan');
    expect(await isCycleReadableByClient('client-1', 'cycle-1')).toBe(false);
  });
});

describe('cycleHasReviewableDraft', () => {
  it('is scoped by client as well as cycle — an id alone is never enough', async () => {
    results = [[{ id: 'beat-1' }]];
    const { cycleHasReviewableDraft } = await import('@/lib/plan');
    expect(await cycleHasReviewableDraft('client-1', 'cycle-1')).toBe(true);
    expect(hasEq(captured.where[0], 'contentCyclePosts.clientId', 'client-1')).toBe(true);
    expect(hasEq(captured.where[0], 'contentCyclePosts.status', 'draft')).toBe(true);
  });

  it('is false when no draft rows exist', async () => {
    results = [[]];
    const { cycleHasReviewableDraft } = await import('@/lib/plan');
    expect(await cycleHasReviewableDraft('client-1', 'cycle-1')).toBe(false);
  });
});
