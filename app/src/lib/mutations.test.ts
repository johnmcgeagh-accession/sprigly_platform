/**
 * mutations.test.ts — regression guard for audit §4 (write-side scoping).
 *
 * Every UPDATE on content_cycle_posts must be scoped by (id, clientId, cycleId),
 * not id alone, so a foreign postId can never mutate another client's or cycle's
 * row. We mock @sprigly/db + drizzle-orm so each write's WHERE condition is a
 * plain, inspectable descriptor and assert all three equalities are present.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  updateWheres: [] as unknown[],
  /** The WHERE of each SELECT, so a read-side guard (ownedPost's draft condition) is
   *  assertable the same way a write-side one is. */
  selectWheres: [] as unknown[],
  selectResults: [] as unknown[],
  insertResults: [] as unknown[],
  insertValues: [] as unknown[],
  /**
   * Rows for `edit-scope.ts:loadDraftCycles` — the write-time draft fence's own query, which
   * terminates on `.groupBy()` rather than `.limit()` and so gets its own queue. Empty means
   * "this client has no draft months", which is every pre-existing test in this file: the
   * guard runs for real and finds nothing, so nothing below it changes shape.
   */
  draftCycleRows: [] as unknown[],
}));

// Instrument drizzle's condition builders to emit inspectable descriptors.
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  ne: (col: unknown, val: unknown) => ({ op: 'ne', col, val }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  // The filtered counts in loadDraftCycles are raw SQL; the fake db serves their RESULT from
  // h.draftCycleRows, so the fragment itself only has to be constructible.
  sql: Object.assign((..._a: unknown[]) => ({ op: 'sql' }), { raw: () => ({ op: 'sql' }) }),
}));

// Fake db: columns resolve to their own name; update().set().where() records the
// WHERE; select() returns queued rows; insert() records values. transaction() runs
// its callback with the same fake handle (writes + ledger commit together), and
// planActivity is a name marker (recordActivity's insert is recorded like any other).
vi.mock('@sprigly/db', () => {
  const contentCyclePosts = new Proxy({}, { get: (_t, prop) => String(prop) });
  const contentCycles = new Proxy({}, { get: (_t, prop) => String(prop) });
  const planActivity = new Proxy({}, { get: (_t, prop) => String(prop) });
  const selectChain: Record<string, unknown> = {
    from() { return selectChain; },
    leftJoin() { return selectChain; },
    where(cond: unknown) { h.selectWheres.push(cond); return selectChain; },
    orderBy() { return selectChain; },
    limit() { return Promise.resolve(h.selectResults.shift() ?? []); },
    // The draft-fence query's terminator (see h.draftCycleRows).
    groupBy() { return Promise.resolve(h.draftCycleRows.shift() ?? []); },
  };
  const db: Record<string, unknown> = {
    select: () => selectChain,
    update: () => ({ set: () => ({ where: (cond: unknown) => { h.updateWheres.push(cond); return Promise.resolve(); } }) }),
    insert: () => ({ values: (v: unknown) => { h.insertValues.push(v); return { returning: () => Promise.resolve(h.insertResults.shift() ?? []) }; } }),
    transaction: (fn: (tx: unknown) => unknown) => Promise.resolve(fn(db)),
  };
  // The real constant, not a stand-in: the point of sharing it is that the writer and the
  // merge classifier use the same string, and a mocked value would hide a drift.
  const DRAFT_PLACEHOLDER_CAPTION = 'Draft idea. Tell Sprigly what this post should be about and it\'ll write the caption.';
  return { db, contentCyclePosts, contentCycles, planActivity, DRAFT_PLACEHOLDER_CAPTION, POST_STATUS_DRAFT: 'draft' };
});

vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));

import { patchPost, softDeletePost, addDraft, addGeneratingPost, revertPost } from './mutations';

const CLIENT = 'client-1';
const CYCLE = 'cycle-1';
const POST = 'post-1';
const TODAY = '2026-09-01';   // injected London 'today' — deterministic (no real clock)

interface EqDescriptor { op: string; col?: string; val?: unknown; parts?: EqDescriptor[] }
/** Every `op` comparison in a (possibly nested) condition — 'eq' for the scoping assertions,
 *  'ne' for the draft-status guard. */
function collectOps(cond: EqDescriptor | undefined, op: string): Array<{ col: string; val: unknown }> {
  if (!cond) return [];
  if (cond.op === op) return [{ col: cond.col as string, val: cond.val }];
  if (cond.op === 'and') return (cond.parts ?? []).flatMap((p) => collectOps(p, op));
  return [];
}
const collectEqs = (cond: EqDescriptor | undefined) => collectOps(cond, 'eq');
function expectFullyScoped(cond: unknown) {
  const eqs = collectEqs(cond as EqDescriptor);
  expect(eqs).toContainEqual({ col: 'id', val: POST });
  expect(eqs).toContainEqual({ col: 'clientId', val: CLIENT });
  expect(eqs).toContainEqual({ col: 'cycleId', val: CYCLE });
}

const baseRow = {
  id: POST, clientId: CLIENT, cycleId: CYCLE, status: 'planned',
  caption: 'x', format: 'single', pillar: 'Product', scheduledDate: '2026-09-01', position: 2, sourceMeta: {},
};

beforeEach(() => {
  h.updateWheres.length = 0;
  h.selectWheres.length = 0;
  h.selectResults.length = 0;
  h.insertResults.length = 0;
  h.insertValues.length = 0;
  h.draftCycleRows.length = 0;
});

/** One `loadDraftCycles` answer: a September cycle (cycle_month 2026-08 → plans 2026-09)
 *  holding drafts and no committed posts, i.e. a month currently rendering as a draft. */
const SEPT_IS_DRAFT = [
  { cycleId: 'cycle-sept', cycleMonth: '2026-08', drafts: 30, committed: 0 },
  { cycleId: CYCLE,        cycleMonth: '2026-07', drafts: 0,  committed: 19 },
];

describe('write-side scoping', () => {
  it('patchPost scopes the UPDATE by id + clientId + cycleId', async () => {
    h.selectResults.push([baseRow]); // ownedPost
    await patchPost(CLIENT, CYCLE, POST, { date: '2026-09-05' }, undefined, TODAY);
    expect(h.updateWheres).toHaveLength(1);
    expectFullyScoped(h.updateWheres[0]);
  });

  it('softDeletePost scopes the UPDATE by id + clientId + cycleId', async () => {
    h.selectResults.push([baseRow]);
    await softDeletePost(CLIENT, CYCLE, POST, undefined, TODAY);
    expect(h.updateWheres).toHaveLength(1);
    expectFullyScoped(h.updateWheres[0]);
  });

  it('revertPost (restore) scopes the UPDATE by id + clientId + cycleId', async () => {
    h.selectResults.push([{
      ...baseRow, status: 'edited',
      sourceMeta: { original: { caption: 'orig', format: 'single', pillar: 'Product', scheduledDate: '2026-09-01', position: 2 } },
    }]);
    await revertPost(CLIENT, CYCLE, POST, undefined, TODAY);
    expect(h.updateWheres).toHaveLength(1);
    expectFullyScoped(h.updateWheres[0]);
  });

  it('revertPost (remove of a new draft) scopes the UPDATE by id + clientId + cycleId', async () => {
    h.selectResults.push([{ ...baseRow, status: 'new' }]);
    await revertPost(CLIENT, CYCLE, POST, undefined, TODAY);
    expect(h.updateWheres).toHaveLength(1);
    expectFullyScoped(h.updateWheres[0]);
  });

  it('addDraft inserts a row scoped to clientId + cycleId', async () => {
    h.selectResults.push([{ position: 5 }]); // max position
    h.insertResults.push([{ id: 'new-post' }]);
    const r = await addDraft(CLIENT, CYCLE, 'instagram', '2026-09-10', undefined, 'single', TODAY);
    expect(r?.mode).toBe('applied');
    expect(h.insertValues[0]).toMatchObject({ clientId: CLIENT, cycleId: CYCLE });
  });

  it('a non-owned post is never written', async () => {
    h.selectResults.push([]); // ownedPost finds nothing
    const r = await patchPost(CLIENT, CYCLE, 'someone-elses-post', { date: '2026-09-05' }, undefined, TODAY);
    expect(r).toBeNull();
    expect(h.updateWheres).toHaveLength(0);
  });
});

describe('date-based edit scope (DATE POLICY)', () => {
  it('patchPost refuses a PAST-dated post (read-only) and writes nothing', async () => {
    h.selectResults.push([{ ...baseRow, scheduledDate: '2026-08-31' }]); // yesterday vs TODAY
    const r = await patchPost(CLIENT, CYCLE, POST, { caption: 'nope' }, undefined, TODAY);
    expect(r).toBeNull();
    expect(h.updateWheres).toHaveLength(0);
  });

  it('patchPost allows editing a post dated exactly TODAY (inclusive boundary)', async () => {
    h.selectResults.push([{ ...baseRow, scheduledDate: TODAY }]);
    const r = await patchPost(CLIENT, CYCLE, POST, { caption: 'ok' }, undefined, TODAY);
    expect(r?.mode).toBe('applied');
    expect(h.updateWheres).toHaveLength(1);
  });

  it('patchPost refuses a date move INTO the past (both-ends rule), even from a future post', async () => {
    h.selectResults.push([{ ...baseRow, scheduledDate: '2026-09-05' }]); // future post
    const r = await patchPost(CLIENT, CYCLE, POST, { date: '2026-08-20' }, undefined, TODAY); // → past
    expect(r).toBeNull();
    expect(h.updateWheres).toHaveLength(0);
  });

  it('patchPost allows a date move that stays today-onward', async () => {
    h.selectResults.push([{ ...baseRow, scheduledDate: '2026-09-05' }]);
    const r = await patchPost(CLIENT, CYCLE, POST, { date: '2026-09-20' }, undefined, TODAY);
    expect(r?.mode).toBe('applied');
    expect(h.updateWheres).toHaveLength(1);
  });

  it('softDeletePost refuses a past-dated post', async () => {
    h.selectResults.push([{ ...baseRow, scheduledDate: '2026-08-31' }]);
    const r = await softDeletePost(CLIENT, CYCLE, POST, undefined, TODAY);
    expect(r).toBeNull();
    expect(h.updateWheres).toHaveLength(0);
  });

  it('addDraft refuses creation on a past date (writes nothing)', async () => {
    const r = await addDraft(CLIENT, CYCLE, 'instagram', '2026-08-20', undefined, 'single', TODAY);
    expect(r).toBeNull();
    expect(h.insertValues).toHaveLength(0);
  });
});

/**
 * ── THE WRITE-TIME DRAFT FENCE (DRAFT POLICY) ────────────────────────────────────────
 *
 * The read-time fence (`excludeDraftPosts()`) stops the ordinary path SEEING a draft month.
 * Nothing stopped it WRITING into one, and the two consequences are different:
 *
 *   an INSERT lands as 'generating' — which `loadDraftBeats` cannot see and `loadPlanPosts`
 *   can, so `committedPostCount` goes 0 → 1 and `resolveSurfaceKind` flips the whole month
 *   out of its draft surface, hiding every planned post in it;
 *
 *   a DATE MOVE keeps the post's own cycle, so it flips nothing and vanishes instead —
 *   out of its own month's grid, and never into the draft's, which renders planned posts only.
 *
 * These pin the refusal at the layer no caller can skip. The routes and `turn.ts` refuse the
 * same writes with a sentence the client reads; this one returns null like every other
 * refusal here, and exists so a caller that forgets cannot get through.
 */
describe('draft-month write fence (DRAFT POLICY)', () => {
  it('addGeneratingPost refuses a cycle that is IN DRAFT — the surface-flip case', async () => {
    h.draftCycleRows.push(SEPT_IS_DRAFT);
    const r = await addGeneratingPost(
      CLIENT, 'cycle-sept',
      { channel: 'instagram', date: '2026-09-15', instruction: 'Back to school.', format: 'reel' },
      undefined, TODAY,
    );
    expect(r).toBeNull();
    expect(h.insertValues).toHaveLength(0);
  });

  it('…and refuses on the DATE alone, even when the target cycle is a committed one', async () => {
    // The agent files an add under the cycle that PLANS the date's month, but a caller that
    // passed the viewed (committed) cycle with a September date would land there just the same.
    h.draftCycleRows.push(SEPT_IS_DRAFT);
    const r = await addGeneratingPost(
      CLIENT, CYCLE,
      { channel: 'instagram', date: '2026-09-15', instruction: 'Back to school.', format: 'reel' },
      undefined, TODAY,
    );
    expect(r).toBeNull();
    expect(h.insertValues).toHaveLength(0);
  });

  it('addDraft refuses a date inside a draft month', async () => {
    h.draftCycleRows.push(SEPT_IS_DRAFT);
    const r = await addDraft(CLIENT, 'cycle-sept', 'instagram', '2026-09-10', undefined, 'single', TODAY);
    expect(r).toBeNull();
    expect(h.insertValues).toHaveLength(0);
  });

  it('patchPost refuses a date MOVE into a draft month, and writes nothing', async () => {
    h.selectResults.push([{ ...baseRow, scheduledDate: '2026-09-05' }]);   // ownedPost
    h.draftCycleRows.push(SEPT_IS_DRAFT);
    const r = await patchPost(CLIENT, CYCLE, POST, { date: '2026-09-20' }, undefined, TODAY);
    expect(r).toBeNull();
    expect(h.updateWheres).toHaveLength(0);
  });

  it('a NON-date edit is untouched by the fence — only a move can change which month it shows in', async () => {
    h.selectResults.push([{ ...baseRow, scheduledDate: '2026-09-05' }]);
    h.draftCycleRows.push(SEPT_IS_DRAFT);
    const r = await patchPost(CLIENT, CYCLE, POST, { caption: 'ok' }, undefined, TODAY);
    expect(r?.mode).toBe('applied');
    expect(h.updateWheres).toHaveLength(1);
  });

  it('a MIXED cycle is not a draft month — it already renders as committed, so adds still work', async () => {
    // committed > 0 AND drafts > 0: resolveSurfaceKind returns committed, so the ordinary
    // path is the correct path there and refusing would be a regression.
    h.draftCycleRows.push([{ cycleId: 'cycle-mixed', cycleMonth: '2026-08', drafts: 4, committed: 11 }]);
    h.selectResults.push([{ position: 5 }]);
    h.insertResults.push([{ id: 'new-post' }]);
    const r = await addDraft(CLIENT, 'cycle-mixed', 'instagram', '2026-09-10', undefined, 'single', TODAY);
    expect(r?.mode).toBe('applied');
    // [0] is the post; [1] is recordActivity's ledger row, which commits with it.
    expect(h.insertValues[0]).toMatchObject({ clientId: CLIENT, cycleId: 'cycle-mixed' });
  });

  it('ownedPost never resolves a DRAFT row, so no ordinary update can convert one', async () => {
    // The row the fake returns is irrelevant — what matters is that the SELECT carries the
    // status condition, because that is what a future caller cannot forget.
    h.selectResults.push([]);
    await patchPost(CLIENT, CYCLE, POST, { caption: 'x' }, undefined, TODAY);
    const nes = collectOps(h.selectWheres[0] as EqDescriptor, 'ne');
    expect(nes).toContainEqual({ col: 'status', val: 'draft' });
  });
});
