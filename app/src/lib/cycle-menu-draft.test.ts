/**
 * cycle-menu-draft.test.ts — a cycle holding a reviewable draft is reachable from the
 * month menu, even when it holds no committed posts.
 *
 * Before this, `liveCount` was computed with the draft fence inside the join, so a
 * draft-only cycle scored 0 and qualified only by being the token's home cycle. A draft on
 * any other cycle was invisible rather than merely mis-rendered
 * (docs/reports/draft-mode-not-rendering.md, anomaly 2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Row { cycleId: string; cycleMonth: string; status: string; syncStatus: string | null; liveCount: number }

const state = {
  rows: [] as Row[],
  draftCycleIds: [] as string[],
};

vi.mock('@sprigly/db', () => {
  const col = new Proxy({}, { get: (_t, k) => ({ name: String(k) }) });
  // loadCycleList: select().from().leftJoin().where().groupBy() → rows
  // cyclesWithReviewableDraft: selectDistinct().from().where() → [{cycleId}]
  const listChain = {
    from: () => listChain, leftJoin: () => listChain, where: () => listChain,
    groupBy: () => Promise.resolve(state.rows.map((r) => ({
      cycleId: r.cycleId, cycleMonth: r.cycleMonth, status: r.status,
      syncStatus: r.syncStatus, liveCount: r.liveCount,
      preservedEdit: 0, preservedEditOrphan: 0,
    }))),
  };
  const draftChain = {
    from: () => draftChain,
    where: () => Promise.resolve(state.draftCycleIds.map((cycleId) => ({ cycleId }))),
  };
  return {
    db: { select: () => listChain, selectDistinct: () => draftChain },
    contentCycles: col, contentCyclePosts: col,
    clientPlanningConfig: col,
    excludeDraftPosts: () => ({}),
    POST_STATUS_DRAFT: 'draft',
    PRE_PLANNING_STATUSES: new Set(['scheduled']),
  };
});
vi.mock('@/lib/steps', () => ({ listStepsForPosts: async () => new Map() }));
vi.mock('@/lib/draft-mutations', () => ({ cycleIsPreCutoff: async () => true }));
vi.mock('@/lib/draft-apply', () => ({ loadReceipts: async () => [] }));

import { loadCycleList, cyclesWithReviewableDraft } from './plan';

const CLIENT = 'client-1';
const row = (over: Partial<Row> & { cycleId: string; cycleMonth: string }): Row =>
  ({ status: 'scheduled', syncStatus: null, liveCount: 0, ...over });

beforeEach(() => { state.rows = []; state.draftCycleIds = []; });

describe('loadCycleList — draft cycles are reachable', () => {
  it('a draft-only NON-HOME cycle appears in the menu', async () => {
    state.rows = [
      row({ cycleId: 'draft-cyc', cycleMonth: '2026-09', liveCount: 0 }),
      row({ cycleId: 'home-cyc',  cycleMonth: '2026-08', liveCount: 12 }),
    ];
    state.draftCycleIds = ['draft-cyc'];

    const out = await loadCycleList(CLIENT, 'instagram', 'home-cyc');
    expect(out.map((c) => c.cycleId)).toContain('draft-cyc');
    // Its label is still the month it PLANS — the draft changes reachability, not labelling.
    expect(out.find((c) => c.cycleId === 'draft-cyc')?.displayMonth).toBe('2026-10');
  });

  it('a genuinely empty non-home cycle is still dropped', async () => {
    state.rows = [
      row({ cycleId: 'empty-cyc', cycleMonth: '2026-09', liveCount: 0 }),
      row({ cycleId: 'home-cyc',  cycleMonth: '2026-08', liveCount: 12 }),
    ];
    state.draftCycleIds = [];   // no drafts anywhere

    const out = await loadCycleList(CLIENT, 'instagram', 'home-cyc');
    expect(out.map((c) => c.cycleId)).not.toContain('empty-cyc');
  });

  it('an out_of_sync non-home cycle WITH a draft is still reachable', async () => {
    // The draft is its own reason to be listed; the sync flag describes the committed plan.
    state.rows = [
      row({ cycleId: 'oos-draft', cycleMonth: '2026-09', liveCount: 0, syncStatus: 'out_of_sync' }),
      row({ cycleId: 'home-cyc',  cycleMonth: '2026-08', liveCount: 12 }),
    ];
    state.draftCycleIds = ['oos-draft'];

    const out = await loadCycleList(CLIENT, 'instagram', 'home-cyc');
    expect(out.map((c) => c.cycleId)).toContain('oos-draft');
  });

  it('an out_of_sync non-home cycle WITHOUT a draft is still dropped', async () => {
    state.rows = [
      row({ cycleId: 'oos', cycleMonth: '2026-09', liveCount: 9, syncStatus: 'out_of_sync' }),
      row({ cycleId: 'home-cyc', cycleMonth: '2026-08', liveCount: 12 }),
    ];
    const out = await loadCycleList(CLIENT, 'instagram', 'home-cyc');
    expect(out.map((c) => c.cycleId)).not.toContain('oos');
  });

  it('the home cycle is kept regardless, as before', async () => {
    state.rows = [row({ cycleId: 'home-cyc', cycleMonth: '2026-09', liveCount: 0 })];
    const out = await loadCycleList(CLIENT, 'instagram', 'home-cyc');
    expect(out.map((c) => c.cycleId)).toEqual(['home-cyc']);
  });
});

describe('cyclesWithReviewableDraft — the batch form of the same rule', () => {
  // The single-cycle form (cycleHasReviewableDraft) is covered by draft-reader.test.ts,
  // which pins its query shape because that shape carries the ownership scoping. The two
  // state the same rule and must change together — see the note on the batch helper.
  it('returns only the cycles that hold a live draft', async () => {
    state.draftCycleIds = ['a', 'c'];
    expect(await cyclesWithReviewableDraft(CLIENT, ['a', 'b', 'c'])).toEqual(new Set(['a', 'c']));
  });

  it('returns an empty set when nothing holds a draft', async () => {
    state.draftCycleIds = [];
    expect(await cyclesWithReviewableDraft(CLIENT, ['a', 'b'])).toEqual(new Set());
  });

  it('an empty id list short-circuits — inArray([]) is not valid SQL', async () => {
    state.draftCycleIds = ['a'];   // would be returned if the query ran
    expect(await cyclesWithReviewableDraft(CLIENT, [])).toEqual(new Set());
  });
});
