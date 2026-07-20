/**
 * draft-invisibility.test.ts — draft beats must never be read as the plan.
 *
 * Build A stores unapproved draft beats in content_cycle_posts (D1). The Part 0 audit
 * found every reader that answers "what is the plan?" and fenced each with
 * excludeDraftPosts(). These tests hold that fence in place.
 *
 * They assert at the QUERY level — that each reader emits the draft-exclusion condition —
 * rather than round-tripping a database. That is deliberate: the leak these guard against
 * is a missing WHERE clause, and a missing WHERE clause is exactly what a query-shape
 * assertion catches. A regression here is someone adding a new plan reader (or rewriting
 * an existing one) without the fence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── The fence, as the readers see it ─────────────────────────────────────────
// excludeDraftPosts() is the single definition (packages/db/src/schema.ts). Stubbed to a
// recognisable sentinel so a query can be inspected for its presence.
const DRAFT_FENCE = Symbol('excludeDraftPosts');

const captured: { where: unknown[]; joins: unknown[] } = { where: [], joins: [] };

vi.mock('@sprigly/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(function this_(this: unknown) { return this; }),
      leftJoin: vi.fn(function this_(this: unknown, _t: unknown, cond: unknown) { captured.joins.push(cond); return this; }),
      where: vi.fn(function this_(this: unknown, cond: unknown) { captured.where.push(cond); return this; }),
      orderBy: vi.fn(() => Promise.resolve([])),
      groupBy: vi.fn(() => Promise.resolve([])),
      limit: vi.fn(() => Promise.resolve([])),
    })),
  },
  contentCycles:    new Proxy({}, { get: (_t, k) => `contentCycles.${String(k)}` }),
  contentCyclePosts: new Proxy({}, { get: (_t, k) => `contentCyclePosts.${String(k)}` }),
  excludeDraftPosts: () => DRAFT_FENCE,
  PRE_PLANNING_STATUSES: new Set(['scheduled']),
}));

vi.mock('drizzle-orm', () => ({
  // `and`/`leftJoin` conditions are collected as arrays so a test can look inside them.
  and:     (...args: unknown[]) => args,
  eq:      (a: unknown, b: unknown) => ['eq', a, b],
  ne:      (a: unknown, b: unknown) => ['ne', a, b],
  asc:     (a: unknown) => ['asc', a],
  desc:    (a: unknown) => ['desc', a],
  gte:     (a: unknown, b: unknown) => ['gte', a, b],
  lt:      (a: unknown, b: unknown) => ['lt', a, b],
  isNull:  (a: unknown) => ['isNull', a],
  sql:     Object.assign(() => 'sql', { raw: () => 'sql' }),
}));

vi.mock('@/lib/steps', () => ({ listStepsForPosts: () => Promise.resolve(new Map()) }));

/** Deep search for the fence sentinel in a nested condition array. */
function containsFence(node: unknown): boolean {
  if (node === DRAFT_FENCE) return true;
  if (Array.isArray(node)) return node.some(containsFence);
  return false;
}

beforeEach(() => { captured.where = []; captured.joins = []; });

describe('draft beats are invisible to every plan reader', () => {
  it('loadPlanPosts — the client plan AND the agent plan context', async () => {
    // One fence, three surfaces: first paint, GET /api/plan, and lib/agent/turn.ts.
    // This is the Bug 4 adjacency — the agent must never count drafts as the plan.
    const { loadPlanPosts } = await import('@/lib/plan');
    await loadPlanPosts('client-1', 'cycle-1');
    expect(captured.where.some(containsFence)).toBe(true);
  });

  it('loadCrossMonthPosts — the calendar grid', async () => {
    const { loadCrossMonthPosts } = await import('@/lib/plan');
    await loadCrossMonthPosts('client-1', 'instagram', '2026-09', 'cycle-1');
    expect(captured.where.some(containsFence)).toBe(true);
  });

  it('loadCycleList — a draft-only cycle must not qualify for the month menu', async () => {
    const { loadCycleList } = await import('@/lib/plan');
    await loadCycleList('client-1', 'instagram', 'cycle-1');
    // Fenced in the JOIN, not the WHERE: the cycle must still return a row with
    // liveCount 0 rather than disappearing from the aggregate entirely.
    expect(captured.joins.some(containsFence)).toBe(true);
  });

  it('isCycleReadableByClient — a draft-only cycle must not be readable', async () => {
    // NOT in the original Part 0 audit; found while applying the fence.
    const { isCycleReadableByClient } = await import('@/lib/plan');
    await isCycleReadableByClient('client-1', 'cycle-1');
    expect(captured.joins.some(containsFence)).toBe(true);
  });
});

describe('the draft status is labelled honestly if a row ever reaches the mapper', () => {
  it("'draft' is a member of PostStatus, so the mapper cannot relabel it 'planned'", async () => {
    // plan.ts coerces any UNRECOGNISED status to 'planned'. Without 'draft' in the union
    // and the STATUSES set, a stray draft would not merely leak — it would become
    // indistinguishable from a committed plan post to both the client UI and the agent.
    // Belt and braces behind the query fence, never a substitute for it.
    //
    // Compile-time assertion: this line stops type-checking if 'draft' is removed from
    // PostStatus, which is the failure mode worth catching (the runtime STATUSES set is
    // module-private, so it cannot be read directly).
    const draftStatus: import('@/lib/types').PostStatus = 'draft';
    expect(draftStatus).toBe('draft');
  });
});
