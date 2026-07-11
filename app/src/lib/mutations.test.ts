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
  selectResults: [] as unknown[],
  insertResults: [] as unknown[],
  insertValues: [] as unknown[],
}));

// Instrument drizzle's condition builders to emit inspectable descriptors.
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
  desc: (col: unknown) => ({ op: 'desc', col }),
}));

// Fake db: columns resolve to their own name; update().set().where() records the
// WHERE; select() returns queued rows; insert() records values. transaction() runs
// its callback with the same fake handle (writes + ledger commit together), and
// planActivity is a name marker (recordActivity's insert is recorded like any other).
vi.mock('@sprigly/db', () => {
  const contentCyclePosts = new Proxy({}, { get: (_t, prop) => String(prop) });
  const planActivity = new Proxy({}, { get: (_t, prop) => String(prop) });
  const selectChain: Record<string, unknown> = {
    from() { return selectChain; },
    where() { return selectChain; },
    orderBy() { return selectChain; },
    limit() { return Promise.resolve(h.selectResults.shift() ?? []); },
  };
  const db: Record<string, unknown> = {
    select: () => selectChain,
    update: () => ({ set: () => ({ where: (cond: unknown) => { h.updateWheres.push(cond); return Promise.resolve(); } }) }),
    insert: () => ({ values: (v: unknown) => { h.insertValues.push(v); return { returning: () => Promise.resolve(h.insertResults.shift() ?? []) }; } }),
    transaction: (fn: (tx: unknown) => unknown) => Promise.resolve(fn(db)),
  };
  return { db, contentCyclePosts, planActivity };
});

vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [] }));

import { patchPost, softDeletePost, addDraft, revertPost } from './mutations';

const CLIENT = 'client-1';
const CYCLE = 'cycle-1';
const POST = 'post-1';
const TODAY = '2026-09-01';   // injected London 'today' — deterministic (no real clock)

interface EqDescriptor { op: string; col?: string; val?: unknown; parts?: EqDescriptor[] }
function collectEqs(cond: EqDescriptor | undefined): Array<{ col: string; val: unknown }> {
  if (!cond) return [];
  if (cond.op === 'eq') return [{ col: cond.col as string, val: cond.val }];
  if (cond.op === 'and') return (cond.parts ?? []).flatMap(collectEqs);
  return [];
}
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
  h.selectResults.length = 0;
  h.insertResults.length = 0;
  h.insertValues.length = 0;
});

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
