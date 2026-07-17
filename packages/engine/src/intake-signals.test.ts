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
  lt:      (c: string, v: unknown) => ({ op: 'lt', c, v }),
  inArray: (c: string, v: unknown[]) => ({ op: 'inArray', c, v }),
  isNull:  (c: string) => ({ op: 'isNull', c }),
}));
vi.mock('@sprigly/db', () => ({
  db: {},   // unused — each test builds its own fake db
  planInputs: {
    id: 'id', clientId: 'clientId', type: 'type', content: 'content', status: 'status',
    createdAt: 'createdAt', relevantFrom: 'relevantFrom', relevantTo: 'relevantTo',
  },
}));

import { hasSuppressibleInput, hasPlannableInput, hasIntakeContent, loadDurableInputs } from './intake-signals.js';
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
    case 'lt':      return row[clause.c] != null && (row[clause.c] as never) <  clause.v;
    default:        return false;
  }
}
// `where(clause)` is BOTH awaitable (a thenable → all matching rows, used by loadDurableInputs /
// hasPlannableInput) AND has `.limit(n)` (used by hasSuppressibleInput). One shape serves both.
function makeDb(rows: Row[]) {
  const select = vi.fn(() => ({
    from: () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: (clause: any) => {
        const filtered = rows.filter((r) => matches(r, clause));
        return {
          limit: (_n: number) => Promise.resolve(filtered.slice(0, _n)),
          then: (resolve: (v: Row[]) => unknown) => resolve(filtered),
        };
      },
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

// ── the month-end date bound — the crash fix (intake-signals.ts:84, "2026-09-31") ──────────────
// The old `${planMonth}-31` literal was an out-of-range DATE for every <31-day plan month, so
// Postgres threw. These pin the FIXED strict bound `relevant_from < first-of-month-after(planMonth)`
// behaviourally: a durable relevant to a short plan month is now plannable (the live no-throw proof
// against the Sprigly/Earl UAT rows is the reproduction run, which a mocked db can't cast dates for).
describe('B — plan-month upper bound (the crash fix: no invalid month-end literal)', () => {
  const durable = (relevantFrom: string, relevantTo: string) =>
    ({ id: 'p1', clientId: 'c1', type: 'idea', status: 'active', createdAt: CYCLE_CREATED, relevantFrom, relevantTo });
  const plannable = (cycleMonth: string, rows: Row[]) =>
    hasPlannableInput(makeDb(rows).db, { clientId: 'c1', cycleMonth, intakeJson: EMPTY });

  it('SEPTEMBER plan month (30 days) — the exact crash month — is plannable, not a throw', async () => {
    // cycle 2026-08 → plan month 2026-09 (Sep, 30 days). Old bound built "2026-09-31" → DATE error.
    expect(await plannable('2026-08', [durable('2026-09-10', '2026-09-20')])).toBe(true);
  });
  it('SEPTEMBER — a durable relevant to a DIFFERENT month is still excluded (window is real)', async () => {
    expect(await plannable('2026-08', [durable('2026-10-01', '2026-10-31')])).toBe(false);
  });
  it('upper bound is first-of-month-AFTER: last day of the plan month IN, first of next month OUT', async () => {
    // Proves the bound is 2026-10-01 (strict), not a "-31" literal: 2026-09-30 counts, 2026-10-01 does not.
    expect(await plannable('2026-08', [durable('2026-09-30', '2026-09-30')])).toBe(true);
    expect(await plannable('2026-08', [durable('2026-10-01', '2026-10-31')])).toBe(false);
  });
  it('FEBRUARY (28 days) — plannable at the 28th (bound first-of-March)', async () => {
    // cycle 2026-01 → plan month 2026-02 (28 days). Old bound "2026-02-31" → DATE error.
    expect(await plannable('2026-01', [durable('2026-02-28', '2026-02-28')])).toBe(true);
    expect(await plannable('2026-01', [durable('2026-03-01', '2026-03-31')])).toBe(false);
  });
  it('LEAP FEBRUARY (29 days) — plannable at the 29th', async () => {
    // cycle 2028-01 → plan month 2028-02 (29 days, leap). Bound first-of-March = 2028-03-01.
    expect(await plannable('2028-01', [durable('2028-02-29', '2028-02-29')])).toBe(true);
  });
  it('31-day month still behaves as before — end-of-month IN, next-month OUT', async () => {
    // cycle 2026-07 → plan month 2026-08 (31 days). Bound first-of-Sep; identical result to the old lte.
    expect(await plannable('2026-07', [durable('2026-08-31', '2026-08-31')])).toBe(true);
    expect(await plannable('2026-07', [durable('2026-09-01', '2026-09-30')])).toBe(false);
  });
});

// ── B and the generator agree BY CONSTRUCTION — one query (loadDurableInputs), two callers ──────
describe('B and loadDurableInputs (the generator\'s source) agree on the window', () => {
  const durable = (relevantFrom: string, relevantTo: string) =>
    ({ id: 'p1', clientId: 'c1', type: 'next_cycle', content: 'x', status: 'active', createdAt: CYCLE_CREATED, relevantFrom, relevantTo });
  // A boundary row is either in BOTH (loader returns it AND B is true) or NEITHER — same query.
  const agree = async (rows: Row[]) => {
    const inGenerator = (await loadDurableInputs(makeDb(rows).db, 'c1', '2026-09')).length > 0;   // plan month
    const isPlannable = await hasPlannableInput(makeDb(rows).db, { clientId: 'c1', cycleMonth: '2026-08', intakeJson: EMPTY }); // cycle+1 = same plan month
    expect(inGenerator).toBe(isPlannable);
    return isPlannable;
  };

  it('boundary IN (last day of plan month) → in BOTH', async () => {
    expect(await agree([durable('2026-09-30', '2026-09-30')])).toBe(true);
  });
  it('boundary OUT (first of next month) → in NEITHER', async () => {
    expect(await agree([durable('2026-10-01', '2026-10-31')])).toBe(false);
  });
  it('open-ended (null bounds) → in BOTH', async () => {
    expect(await agree([durable(null as unknown as string, null as unknown as string)])).toBe(true);
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
