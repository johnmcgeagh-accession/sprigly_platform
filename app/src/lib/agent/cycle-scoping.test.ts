/**
 * cycle-scoping.test.ts — the agent talks about the month you are LOOKING at.
 *
 * ── The two screenshots this file exists for ─────────────────────────────────────────
 *
 * On the **August** surface the agent refused an edit:
 *   "August 5th is in a past workbook… I can only edit posts in the current September 2026 cycle"
 * On the **September** surface it claimed:
 *   "the plan digest shows posts starting October 1st"
 * …while September's posts were on screen.
 *
 * Three defects, and together they produce both sentences exactly.
 *
 * A · THE AGENT IS ANCHORED TO THE MAGIC LINK, NOT THE VIEW.
 *   `app/src/app/api/plan/agent/route.ts` took `const { clientId, cycleId } = session`, so the
 *   cycle was whichever one the link was issued for. The client can browse every month
 *   (`switchCycle`) and the agent never moved with them — it loaded a different month's posts
 *   and then reasoned about the month it could see.
 *
 * B · A CYCLE IS LABELLED BY ITS DATA MONTH AND DIGESTED BY ITS PLAN MONTH.
 *   `contentCycles.cycleMonth` is the DATA month; the month a cycle PLANS is `cycleMonth + 1`
 *   (`plan.ts:250`, `displayMonth = nextMonth(cycleMonth)`). `getClientCycleMonths` printed the
 *   raw `cycleMonth` and marked it "[current, editable]", while `cycleDigest` listed that same
 *   cycle's posts — which are dated a month later. So the parser's own prompt said
 *   "September 2026 [current, editable]" directly above a digest starting 1 October. Both
 *   screenshot sentences are that one contradiction, read back.
 *
 * C · THE IN-MONTH MOVE GUARD IS OFF BY ONE, ALWAYS.
 *   `turn.ts` compared `task.toDate.slice(0,7)` — a PLAN date — against `cycleMonth`, the DATA
 *   month. Those can never be equal for a real post, so every in-month move was refused with
 *   "moving posts to a different month isn't available yet."
 *
 * The fix grounds the turn in the VIEWED cycle, labels every cycle by the month it plans, and
 * replaces the month-equality guard with the only rule that was ever wanted: a post dated before
 * today cannot move, and nothing else is a refusal.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {} }));
vi.mock('../plan', () => ({ loadPlanPosts: async () => [] }));

import { planMonthOf, describeCycles, type CycleRow } from './cycle-state';

/** Earl of East's real shape at the time of the screenshots: three months on record. */
const CYCLES: CycleRow[] = [
  { id: 'cyc-jul', month: '2026-06', status: 'workbook_built' },   // plans JULY
  { id: 'cyc-aug', month: '2026-07', status: 'workbook_built' },   // plans AUGUST
  { id: 'cyc-sep', month: '2026-08', status: 'scheduled' },        // plans SEPTEMBER
  { id: 'cyc-oct', month: '2026-09', status: 'scheduled' },        // plans OCTOBER
];

describe('B · a cycle is named by the month it PLANS', () => {
  it('planMonthOf turns the data month into the plan month', () => {
    expect(planMonthOf('2026-08')).toBe('2026-09');
    expect(planMonthOf('2026-12')).toBe('2027-01');   // and it rolls the year
  });

  it('THE BUG: the old list called the September cycle "August 2026"', () => {
    // cyc-sep holds September's posts. Labelling it by cycleMonth called it August, which is
    // the contradiction the client read back to us in both screenshots.
    const listed = describeCycles(CYCLES, 'cyc-sep');
    expect(listed).toContain('September 2026 (2026-09)');
    expect(listed).not.toContain('August 2026 (2026-08) [current');
  });

  it('marks the VIEWED cycle as the one being talked about', () => {
    const listed = describeCycles(CYCLES, 'cyc-aug');
    expect(listed).toMatch(/August 2026 .*\[the month on screen\]/);
    // …and only that one.
    expect(listed.match(/\[the month on screen\]/g)).toHaveLength(1);
  });

  it('lists ADJACENT FUTURE cycles so a cross-month intent still resolves', () => {
    // Standing on August, September and October are reachable — a client asking to push a post
    // into next month must not be told the month does not exist.
    const listed = describeCycles(CYCLES, 'cyc-aug');
    expect(listed).toContain('September 2026');
    expect(listed).toContain('October 2026');
    expect(listed).toContain('July 2026');
  });

  it('never says "editable" about a whole cycle — editability is per DATE, not per month', () => {
    const listed = describeCycles(CYCLES, 'cyc-sep');
    expect(listed).not.toMatch(/editable/i);
    // Nor does it call a cycle's status a reason not to edit.
    expect(listed).not.toMatch(/past workbook|read-only/i);
  });

  it('still carries each cycle’s status, which is ours to know and not a refusal ground', () => {
    expect(describeCycles(CYCLES, 'cyc-sep')).toContain('workbook_built');
  });
});
