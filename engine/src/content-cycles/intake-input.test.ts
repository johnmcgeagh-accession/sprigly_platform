/**
 * intake-input test — hasIntakeContent (pure) + hasAnyIntakeInput (intake OR durable
 * plan_input created since the cycle). Part B of the intake-capture build.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const gteCalls: Array<[unknown, unknown]> = [];

vi.mock('@sprigly/db', () => ({
  db: {},
  planInputs: { id: {}, clientId: {}, type: {}, status: {}, createdAt: {} },
}));
vi.mock('drizzle-orm', () => ({
  eq:      vi.fn(() => 'eq'),
  and:     vi.fn(() => 'and'),
  inArray: vi.fn(() => 'inArray'),
  gte:     vi.fn((col: unknown, val: unknown) => { gteCalls.push([col, val]); return 'gte'; }),
}));

import { hasIntakeContent, hasAnyIntakeInput, type IntakeInputCycle } from './intake-input.js';

// db whose plan_inputs lookup resolves to `rows`.
function makeDb(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from:  vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const CYCLE_CREATED = new Date('2026-07-01T00:00:00Z');
const baseCycle = (intakeJson: unknown): IntakeInputCycle => ({ clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson });

beforeEach(() => { vi.clearAllMocks(); gteCalls.length = 0; });

describe('hasIntakeContent (pure, mirrors confirmIntake guard)', () => {
  it('false for null / empty', () => {
    expect(hasIntakeContent(null)).toBe(false);
    expect(hasIntakeContent({ planContent: { answers: {}, freeNotes: '' } } as never)).toBe(false);
    expect(hasIntakeContent({ planContent: { answers: { q1: '   ' }, freeNotes: '  ' } } as never)).toBe(false);
  });
  it('true when an answer is non-empty', () => {
    expect(hasIntakeContent({ planContent: { answers: { q1: 'launch on the 5th' }, freeNotes: '' } } as never)).toBe(true);
  });
  it('true when freeNotes is non-empty', () => {
    expect(hasIntakeContent({ planContent: { answers: {}, freeNotes: 'push the launch' } } as never)).toBe(true);
  });
});

describe('hasAnyIntakeInput', () => {
  it('empty intake + no durable inputs → false', async () => {
    const db = makeDb([]);
    expect(await hasAnyIntakeInput(db, baseCycle({ planContent: { answers: {}, freeNotes: '' } }))).toBe(false);
  });

  it('answers-only intake → true (no plan_inputs query needed)', async () => {
    const db = makeDb([]);
    expect(await hasAnyIntakeInput(db, baseCycle({ planContent: { answers: { q1: 'yes' }, freeNotes: '' } }))).toBe(true);
    expect(db.select).not.toHaveBeenCalled();   // short-circuits on intake content
  });

  it('freeNotes-only intake → true', async () => {
    const db = makeDb([]);
    expect(await hasAnyIntakeInput(db, baseCycle({ planContent: { answers: {}, freeNotes: 'note' } }))).toBe(true);
  });

  it('empty intake + a live idea plan_input since cycle creation → true', async () => {
    const db = makeDb([{ id: 'pi-1' }]);
    expect(await hasAnyIntakeInput(db, baseCycle(null))).toBe(true);
    // recency bound is applied against the cycle's createdAt (stale rows filtered in SQL).
    expect(gteCalls.some(([, val]) => val === CYCLE_CREATED)).toBe(true);
  });

  it('empty intake + only STALE plan_inputs (created before the cycle) → false', async () => {
    // The gte(createdAt, cycle.createdAt) bound excludes pre-cycle rows → the query returns [].
    const db = makeDb([]);
    expect(await hasAnyIntakeInput(db, baseCycle(null))).toBe(false);
    expect(gteCalls.some(([, val]) => val === CYCLE_CREATED)).toBe(true);
  });
});
