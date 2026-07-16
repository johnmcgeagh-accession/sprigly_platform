/**
 * intake-signals test — the three intake questions and, crucially, that A's and B's durable
 * WINDOWS differ: a durable note captured after the cycle but NOT relevant to the plan month
 * suppresses (A) yet is not plannable (B). That asymmetry is deliberate and is pinned here.
 */
import { describe, it, expect, vi } from 'vitest';

// Structured drizzle operators so the fake db can interpret a WHERE clause.
vi.mock('drizzle-orm', () => ({
  and:     (...a: unknown[]) => ({ op: 'and', a }),
  or:      (...a: unknown[]) => ({ op: 'or', a }),
  eq:      (c: string, v: unknown) => ({ op: 'eq', c, v }),
  gte:     (c: string, v: unknown) => ({ op: 'gte', c, v }),
  lte:     (c: string, v: unknown) => ({ op: 'lte', c, v }),
  inArray: (c: string, v: unknown[]) => ({ op: 'inArray', c, v }),
  isNull:  (c: string) => ({ op: 'isNull', c }),
}));
vi.mock('@sprigly/db', () => ({
  db: {},   // unused — each test builds its own fake db
  planInputs: {
    id: 'id', clientId: 'clientId', type: 'type', status: 'status',
    createdAt: 'createdAt', relevantFrom: 'relevantFrom', relevantTo: 'relevantTo',
  },
}));

import { hasSuppressibleInput, hasPlannableInput, hasIntakeContent } from './intake-signals.js';
import { intakeCompleteness } from './intake-completeness.js';

// ── a tiny WHERE interpreter over a fixture of plan_input rows ────────────────────────────────
type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matches(row: Row, clause: any): boolean {
  switch (clause.op) {
    case 'and':     return clause.a.every((c: unknown) => matches(row, c));
    case 'or':      return clause.a.some((c: unknown) => matches(row, c));
    case 'eq':      return row[clause.c] === clause.v;
    case 'inArray': return (clause.v as unknown[]).includes(row[clause.c]);
    case 'isNull':  return row[clause.c] == null;
    case 'gte':     return row[clause.c] != null && (row[clause.c] as never) >= clause.v;
    case 'lte':     return row[clause.c] != null && (row[clause.c] as never) <= clause.v;
    default:        return false;
  }
}
function makeDb(rows: Row[]) {
  const select = vi.fn(() => ({
    from: () => ({
      where: (clause: unknown) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        limit: (_n: number) => Promise.resolve(rows.filter((r) => matches(r, clause as any)).slice(0, _n)),
      }),
    }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { select } as any, select };
}

const CYCLE_CREATED = new Date('2026-07-08T00:00:00Z');
const EMPTY  = { planContent: { answers: {}, freeNotes: '' } };
const ANSWER = { planContent: { answers: { q1: 'launch on the 5th' }, freeNotes: '' } };

// ── hasIntakeContent (pure) ───────────────────────────────────────────────────────────────────
describe('hasIntakeContent (pure)', () => {
  it('false for null/empty, true for any answer or free notes', () => {
    expect(hasIntakeContent(null)).toBe(false);
    expect(hasIntakeContent(EMPTY as never)).toBe(false);
    expect(hasIntakeContent(ANSWER as never)).toBe(true);
    expect(hasIntakeContent({ planContent: { answers: {}, freeNotes: 'push it' } } as never)).toBe(true);
  });
});

// ── A: hasSuppressibleInput (createdAt window) — unchanged from the old hasAnyIntakeInput ───────
describe('A — hasSuppressibleInput (suppression, created_at window)', () => {
  it('empty intake + no durable → false', async () => {
    const { db } = makeDb([]);
    expect(await hasSuppressibleInput(db, { clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson: EMPTY })).toBe(false);
  });
  it('intake content → true WITHOUT a DB read (short-circuit)', async () => {
    const { db, select } = makeDb([]);
    expect(await hasSuppressibleInput(db, { clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson: ANSWER })).toBe(true);
    expect(select).not.toHaveBeenCalled();
  });
  it('empty intake + a live durable created AFTER the cycle → true', async () => {
    const { db } = makeDb([{ id: 'p1', clientId: 'c1', type: 'idea', status: 'active', createdAt: new Date('2026-07-14T00:00:00Z'), relevantFrom: null, relevantTo: null }]);
    expect(await hasSuppressibleInput(db, { clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson: EMPTY })).toBe(true);
  });
  it('empty intake + only a STALE durable created BEFORE the cycle → false', async () => {
    const { db } = makeDb([{ id: 'p1', clientId: 'c1', type: 'idea', status: 'active', createdAt: new Date('2026-06-01T00:00:00Z'), relevantFrom: null, relevantTo: null }]);
    expect(await hasSuppressibleInput(db, { clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson: EMPTY })).toBe(false);
  });
});

// ── B: hasPlannableInput (relevance window) — the behaviour change ──────────────────────────────
describe('B — hasPlannableInput (plannable, relevance window)', () => {
  const cyc = (intakeJson: unknown) => ({ clientId: 'c1', cycleMonth: '2026-07', intakeJson });   // plan month = 2026-08

  it('genuinely empty (no intake, no durable) → false', async () => {
    const { db } = makeDb([]);
    expect(await hasPlannableInput(db, cyc(EMPTY))).toBe(false);
  });
  it('intake content → true WITHOUT a DB read', async () => {
    const { db, select } = makeDb([]);
    expect(await hasPlannableInput(db, cyc(ANSWER))).toBe(true);
    expect(select).not.toHaveBeenCalled();
  });
  it('durable-only, RELEVANT to the plan month → true (the fix: a durable-only cycle is plannable)', async () => {
    const { db } = makeDb([{ id: 'p1', clientId: 'c1', type: 'next_cycle', status: 'active', createdAt: CYCLE_CREATED, relevantFrom: '2026-08-01', relevantTo: '2026-08-31' }]);
    expect(await hasPlannableInput(db, cyc(EMPTY))).toBe(true);
  });
});

// ── the window asymmetry (deliberate) ──────────────────────────────────────────────────────────
describe('A vs B — same durable note, different windows', () => {
  // One durable note: captured AFTER the cycle (in A's window) but relevant to 2025, NOT to the
  // plan month 2026-08 (outside B's window).
  const note = { id: 'p1', clientId: 'c1', type: 'idea', status: 'active', createdAt: new Date('2026-07-14T00:00:00Z'), relevantFrom: '2025-01-01', relevantTo: '2025-12-31' };

  it('suppresses (A = true) but is NOT plannable (B = false)', async () => {
    expect(await hasSuppressibleInput(makeDb([note]).db, { clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson: EMPTY })).toBe(true);
    expect(await hasPlannableInput(makeDb([note]).db, { clientId: 'c1', cycleMonth: '2026-07', intakeJson: EMPTY })).toBe(false);
  });

  it('A and B AGREE (both true) whenever intake content is present', async () => {
    const a = await hasSuppressibleInput(makeDb([]).db, { clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson: ANSWER });
    const b = await hasPlannableInput(makeDb([]).db, { clientId: 'c1', cycleMonth: '2026-07', intakeJson: ANSWER });
    expect([a, b]).toEqual([true, true]);
  });
});

// ── the behaviour change: a durable-only cycle — BEFORE blocked, AFTER plannable ───────────────
describe('durable-only cycle — before vs after', () => {
  // Empty intake + one durable note relevant to the plan month (2026-08). Staging has zero of
  // these, so this is the constructed fixture.
  const relevantNote = { id: 'p1', clientId: 'c1', type: 'idea', status: 'active', createdAt: CYCLE_CREATED, relevantFrom: '2026-08-01', relevantTo: '2026-08-31' };

  it('BEFORE: the old gate (intake content only) blocks planning; suppression already fires', async () => {
    // The pre-change planning gate was `hasIntakeContent(intake)` — answers/freeNotes only.
    const oldPlanningGate = hasIntakeContent(EMPTY as never);
    expect(oldPlanningGate).toBe(false);                                    // planning BLOCKED
    expect(await hasSuppressibleInput(makeDb([relevantNote]).db, { clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson: EMPTY })).toBe(true);  // reminders SUPPRESSED
  });

  it('AFTER: hasPlannableInput allows planning; suppression is unchanged', async () => {
    expect(await hasPlannableInput(makeDb([relevantNote]).db, { clientId: 'c1', cycleMonth: '2026-07', intakeJson: EMPTY })).toBe(true);          // planning ALLOWED
    expect(await hasSuppressibleInput(makeDb([relevantNote]).db, { clientId: 'c1', createdAt: CYCLE_CREATED, intakeJson: EMPTY })).toBe(true);  // still SUPPRESSED
  });
});

// ── C: intakeCompleteness (form completeness, question-list keyed) ──────────────────────────────
describe('C — intakeCompleteness (form completeness)', () => {
  const questions = ['Q1', 'Q2', 'Q3'];
  it('counts answered against the CURRENT question list', () => {
    expect(intakeCompleteness({ Q1: 'yes', Q2: '  ', Q3: 'x' }, questions)).toEqual({ answered: ['Q1', 'Q3'], total: 3 });
    expect(intakeCompleteness({}, questions)).toEqual({ answered: [], total: 3 });
  });
  it('does NOT count an orphaned answer (keyed to a question not in the list)', () => {
    expect(intakeCompleteness({ 'a since-removed question': 'answered!' }, questions)).toEqual({ answered: [], total: 3 });
  });
});
