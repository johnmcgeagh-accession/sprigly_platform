/**
 * draft-row-gate.test.ts — the route-level half of the write-time draft fence.
 *
 * ── The hole ─────────────────────────────────────────────────────────────────────────
 *
 * `resolvePostForEdit` resolved a post by (client, id) with NO status condition, and eleven
 * routes gate on it: PATCH and DELETE /api/posts/:id, revert, shape, retry-generation, steps,
 * steps/:stepId, checklist/generate, checklist/regenerate, /api/plan/shape, /api/plan/script,
 * /api/plan/hooks. Every one of them therefore accepted a DRAFT beat id — which the client
 * holds, because the draft surface renders those ids, and which the agent's own digest prints
 * beside every planned post.
 *
 * What each then did was worse than a leak. `patchPost` stamps `status: 'edited'` on whatever
 * it updates, so a PATCH would have CONVERTED an unapproved slot into a committed post — the
 * same surface flip the add path caused, through a different door. `enqueueShape` would have
 * written a caption onto one. `softDeletePost` would have tombstoned one behind the
 * hard-delete/restore contract `draft-mutations.ts` owns.
 *
 * A draft's only write paths are `draft-mutations.ts` (behind `requireDraftMutable`) and
 * `draft-apply.ts` (behind `cycleIsPreCutoff`). Neither goes through this gate, so refusing
 * here costs no legitimate caller anything.
 *
 * ── And the cycle-level half ─────────────────────────────────────────────────────────
 *
 * `loadDraftCycles` states "in draft" exactly as `resolveSurfaceKind` states it —
 * `committedPostCount === 0 && draftBeatCount > 0` — because the harm being guarded IS the
 * surface flip. A MIXED cycle already renders as committed, so it is not a draft month and
 * the ordinary path there must keep working.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  postRows: [] as unknown[],
  cycleRows: [] as unknown[],
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  ne: (col: unknown, val: unknown) => ({ op: 'ne', col, val }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
  sql: Object.assign((..._a: unknown[]) => ({ op: 'sql' }), { raw: () => ({ op: 'sql' }) }),
}));

vi.mock('@sprigly/db', () => {
  const col = () => new Proxy({}, { get: (_t, p) => String(p) });
  const chain: Record<string, unknown> = {
    from() { return chain; },
    leftJoin() { return chain; },
    where() { return chain; },
    limit() { return Promise.resolve(h.postRows.shift() ?? []); },
    groupBy() { return Promise.resolve(h.cycleRows.shift() ?? []); },
  };
  return {
    db: { select: () => chain },
    contentCyclePosts: col(), contentCycles: col(),
    POST_STATUS_DRAFT: 'draft',
  };
});

vi.mock('./steps', () => ({ resolveTodayIso: () => '2026-08-04' }));

import { gatePostEdit, loadDraftCycles, cycleIsInDraft, draftMonthFor, landsInDraftMonth } from './edit-scope';

const CLIENT = 'c1';
const TODAY = '2026-08-04';

beforeEach(() => { h.postRows.length = 0; h.cycleRows.length = 0; });

const row = (over: Record<string, unknown> = {}) =>
  ({ cycleId: 'cyc-aug', scheduledDate: '2026-08-20', channel: 'instagram', status: 'planned', ...over });

describe('gatePostEdit refuses a DRAFT row', () => {
  it('409 draft_row for an unapproved planned post', async () => {
    h.postRows.push([row({ status: 'draft', cycleId: 'cyc-sep', scheduledDate: '2026-09-16' })]);
    const g = await gatePostEdit(CLIENT, 'beat-1', TODAY);
    expect(g.ok).toBe(false);
    expect(g).toMatchObject({ status: 409, error: 'draft_row' });
  });

  it('the draft refusal outranks the date one — a FUTURE draft is still refused as a draft', async () => {
    // Both facts are true of a September beat on 4 August: it is future-dated AND it is a
    // draft. The client needs the second, because "that date has passed" would be false.
    h.postRows.push([row({ status: 'draft', scheduledDate: '2999-01-01' })]);
    const g = await gatePostEdit(CLIENT, 'beat-1', TODAY);
    expect(g).toMatchObject({ error: 'draft_row' });
  });

  it('a committed post is unaffected — the gate still returns its real cycle', async () => {
    h.postRows.push([row()]);
    const g = await gatePostEdit(CLIENT, 'post-1', TODAY);
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.cycleId).toBe('cyc-aug');
  });

  it('a past-dated committed post still gets the DATE refusal, unchanged', async () => {
    h.postRows.push([row({ scheduledDate: '2026-07-01' })]);
    expect(await gatePostEdit(CLIENT, 'post-1', TODAY)).toMatchObject({ status: 403, error: 'read_only' });
  });

  it('a foreign / missing id is still 404, and never says which', async () => {
    h.postRows.push([]);
    expect(await gatePostEdit(CLIENT, 'nope', TODAY)).toMatchObject({ status: 404, error: 'not_found' });
  });
});

describe('loadDraftCycles — "in draft" as the surface states it', () => {
  /** September: 30 drafts, 0 committed → a draft month. August: committed → not. */
  const IVY = [
    { cycleId: 'cyc-sep', cycleMonth: '2026-08', drafts: 30, committed: 0 },
    { cycleId: 'cyc-aug', cycleMonth: '2026-07', drafts: 0,  committed: 19 },
  ];

  it('keys a draft cycle by id AND by the month it PLANS (cycle_month + 1)', async () => {
    h.cycleRows.push(IVY);
    const d = await loadDraftCycles(CLIENT);
    expect([...d.byId]).toEqual(['cyc-sep']);
    expect(d.byPlanMonth.get('2026-09')).toBe('cyc-sep');
    // The stored cycle_month is NOT the plan month, and keying on it would put the fence
    // one month early — refusing August and allowing September, i.e. exactly backwards.
    expect(d.byPlanMonth.has('2026-08')).toBe(false);
  });

  it('a MIXED cycle is not in draft — it already renders as committed', async () => {
    h.cycleRows.push([{ cycleId: 'cyc-mix', cycleMonth: '2026-08', drafts: 4, committed: 11 }]);
    expect((await loadDraftCycles(CLIENT)).byId.size).toBe(0);
  });

  it('an EMPTY cycle is not in draft either — nothing to hide', async () => {
    h.cycleRows.push([{ cycleId: 'cyc-empty', cycleMonth: '2026-09', drafts: 0, committed: 0 }]);
    expect((await loadDraftCycles(CLIENT)).byId.size).toBe(0);
  });

  it('cycleIsInDraft answers for the cycle an INSERT names', async () => {
    h.cycleRows.push(IVY);
    expect(await cycleIsInDraft(CLIENT, 'cyc-sep')).toBe(true);
    h.cycleRows.push(IVY);
    expect(await cycleIsInDraft(CLIENT, 'cyc-aug')).toBe(false);
  });

  it('draftMonthFor answers for the month a DATE MOVE names', async () => {
    h.cycleRows.push(IVY);
    expect(await draftMonthFor(CLIENT, '2026-09-15')).toBe('2026-09');
    h.cycleRows.push(IVY);
    expect(await draftMonthFor(CLIENT, '2026-08-15')).toBeNull();
  });

  it('landsInDraftMonth takes EITHER key, and neither means no', async () => {
    h.cycleRows.push(IVY);
    expect(await landsInDraftMonth(CLIENT, 'cyc-sep', null)).toBe(true);
    h.cycleRows.push(IVY);
    expect(await landsInDraftMonth(CLIENT, null, '2026-09-15')).toBe(true);
    h.cycleRows.push(IVY);
    expect(await landsInDraftMonth(CLIENT, 'cyc-aug', '2026-08-15')).toBe(false);
    // No key at all must not cost a query — a caller with nothing to check asks nothing.
    expect(await landsInDraftMonth(CLIENT, null, null)).toBe(false);
    expect(h.cycleRows).toHaveLength(0);
  });
});
