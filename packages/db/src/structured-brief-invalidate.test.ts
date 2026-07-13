/**
 * structured-brief-invalidate test — a pre-planning intake change clears the persisted
 * structured_brief (so ensureStructuredBrief re-extracts); a planning-or-after cycle is
 * never touched. Part C of the intake-capture build.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// NB: drizzle-orm is NOT mocked — schema.ts needs its real `sql`/pg-core. The helper's real
// eq() just builds a where clause the mock db ignores, so the assertions are unaffected.
import { clearStructuredBriefIfPrePlanning, PRE_PLANNING_STATUSES } from './structured-brief-invalidate.js';

// Minimal drizzle-shaped mock: select().from().where().limit() → rows; update().set().where().
function makeDb(row: { status: string; structuredBrief: unknown } | undefined) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const setFn       = vi.fn().mockReturnValue({ where: updateWhere });
  const update      = vi.fn().mockReturnValue({ set: setFn });
  const db = {
    select: vi.fn().mockReturnValue({
      from:  vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(row ? [row] : []),
    }),
    update,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, update, setFn };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('clearStructuredBriefIfPrePlanning', () => {
  it('clears the brief when pre-planning and a brief is persisted', async () => {
    const { db, update, setFn } = makeDb({ status: 'intake_confirmed', structuredBrief: { products: [] } });
    const result = await clearStructuredBriefIfPrePlanning(db, 'cyc-1');
    expect(result).toBe('cleared');
    expect(update).toHaveBeenCalledTimes(1);
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ structuredBrief: null }));
  });

  it('does NOT touch a cycle already at planning', async () => {
    const { db, update } = makeDb({ status: 'planning', structuredBrief: { products: [] } });
    const result = await clearStructuredBriefIfPrePlanning(db, 'cyc-1');
    expect(result).toBe('skipped_planning_or_after');
    expect(update).not.toHaveBeenCalled();
  });

  it('does NOT touch a post-planning cycle (e.g. delivered)', async () => {
    const { db, update } = makeDb({ status: 'delivered', structuredBrief: { products: [] } });
    expect(await clearStructuredBriefIfPrePlanning(db, 'cyc-1')).toBe('skipped_planning_or_after');
    expect(update).not.toHaveBeenCalled();
  });

  it('no-ops (no write) when pre-planning but no brief persisted', async () => {
    const { db, update } = makeDb({ status: 'requested', structuredBrief: null });
    expect(await clearStructuredBriefIfPrePlanning(db, 'cyc-1')).toBe('noop_no_brief');
    expect(update).not.toHaveBeenCalled();
  });

  it('returns not_found for an unknown cycle', async () => {
    const { db, update } = makeDb(undefined);
    expect(await clearStructuredBriefIfPrePlanning(db, 'nope')).toBe('not_found');
    expect(update).not.toHaveBeenCalled();
  });

  it('pre-planning status set excludes planning and later (and failed)', () => {
    expect([...PRE_PLANNING_STATUSES].sort()).toEqual(
      ['awaiting_confirmation', 'intake_confirmed', 'reply_received', 'requested', 'scheduled'].sort(),
    );
    for (const s of ['planning', 'workbook_built', 'delivered', 'active', 'finalised', 'closed', 'failed']) {
      expect(PRE_PLANNING_STATUSES.has(s)).toBe(false);
    }
  });
});
