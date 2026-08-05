/**
 * agent/plan-facts.ts — the numbers about a month, COMPUTED ONCE.
 *
 * ── The failure this exists for ──────────────────────────────────────────────────────
 *
 * Asked four times what was in a settled 30-post September, the agent answered 27, then 15,
 * then 26, then 30, then 28. Asked for the pillar balance it produced seven lines summing to
 * 29 against a month holding 30 — three lines wrong, two under and one over, offsetting into a
 * total that looked nearly right. Asked how many dates were empty it said 2; the answer is 4.
 *
 * None of those is a reasoning failure and none of them is fixable by prompting. The plan state
 * handed the model a flat, date-sorted list of rows and no totals, so every one of those
 * questions was an invitation to COUNT — and the last one was worse than that. "How many empty
 * dates?" was answered by subtracting posts from days, which is only valid if no date holds more
 * than one post. Four September dates hold two. The state never asserted one-per-day; the model
 * supplied it, because it had no other way through.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────
 *
 * ANY FACT A CLIENT MIGHT ASK FOR IS STATED, NOT DERIVED. It is the same rule that closed the
 * past-date inversion (state each row's side of today), the month boundary (state the calendar
 * window, never max(scheduled_date)) and the rolling week (state Monday-to-Sunday by date):
 * state the answer instead of setting the exercise. This file is that rule applied to
 * arithmetic, which is the one class of question where a small model's error is invisible —
 * a wrong count reads exactly like a right one.
 *
 * ── Why the doubled-date line is here and not left to be noticed ─────────────────────
 *
 * `EMPTY DATES` alone would fix the observed answer and leave the reasoning intact: the next
 * question phrased differently would be subtracted again. So the state also says, in words,
 * which dates hold more than one and that posts are NOT one per day. The false premise is
 * contradicted where it would be formed, not just its output corrected.
 *
 * ── Its relationship to plan-answers.ts ──────────────────────────────────────────────
 *
 * `plan-answers.ts` is the precedent and the doctrine — *"the one thing worse than not answering
 * a client's question is answering it with an invented number"* — and this file is that doctrine
 * applied to the committed plan agent, which had no equivalent.
 *
 * Its functions are NOT reused here, and deliberately not. They compute none of these
 * quantities: `answerPlanQuestion` takes a `length` of the list it was handed, and neither it
 * nor `answerIdeasQuestion` groups by date, tallies a field, or knows a month has a calendar.
 * Nor is anything duplicated by adding them — "how many rows are in this list" and "how many
 * rows fall in this month" are different questions, so there is no second account of one fact
 * to collapse. What is shared is the rule, not the code.
 *
 * ── Structural typing, deliberately ──────────────────────────────────────────────────
 *
 * `DatedItem` is the minimum a tally needs, so `PlanPost` and `DraftBeatView` both satisfy it
 * without either being imported. That is what lets a draft month be counted as what it holds
 * rather than reported as thirty empty dates, and it is what would let the draft surface adopt
 * these numbers later without this file learning about either type.
 *
 * Pure. No database, no React, no month-name table (labels arrive from the caller, because
 * three copies of MONTH_NAMES already exist in this tree and a fourth is not an improvement).
 */

/** The minimum a fact needs off a row. `PlanPost` and `DraftBeatView` both satisfy it. */
export interface DatedItem {
  /** ISO 'YYYY-MM-DD'. */
  date:    string;
  format?: string | null;
  pillar?: string | null;
  status?: string | null;
}

/** One bucket of a tally: the value, and how many rows carry it. */
export interface Tally {
  key: string;
  n:   number;
}

/** Every counted fact about one month. Data only — `factLines` turns it into prompt text. */
export interface MonthFacts {
  /** 'YYYY-MM'. */
  month:    string;
  /** Days in this month, from its own calendar (28/29/30/31). */
  days:     number;
  /** Rows dated in this month. */
  total:    number;
  /** Dates holding at least one row, ascending ISO. */
  occupied: string[];
  /** Dates holding none, ascending ISO. `occupied ∪ empty` is always the whole month. */
  empty:    string[];
  /** Dates holding MORE THAN ONE, with how many — the premise the model invents without this. */
  doubled:  Array<{ date: string; n: number }>;
  byFormat: Tally[];
  byPillar: Tally[];
  byStatus: Tally[];
}

/** Days in the month of 'YYYY-MM'. Day 0 of the NEXT month is the last day of this one — the
 *  same trick `monthWindow` uses, and for the same reason: a literal 31 is an invalid date in
 *  five months of the year and February moves. */
export function daysInMonth(month: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return 31;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

/** Every ISO date in a month, ascending. */
function datesOf(month: string): string[] {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * Count rows by one field, commonest first.
 *
 * Ties break alphabetically so the same rows always render the same string: this text goes into
 * a prompt and into assertions, and a tally that reorders between two identical turns would look
 * like the plan changed.
 */
function tally(items: readonly DatedItem[], pick: (i: DatedItem) => string): Tally[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = pick(i);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

/**
 * Every fact about one month, from the rows DATED in it.
 *
 * Keyed on the DATE, never on which cycle owns the row — because the calendar is date-authoritative
 * (`loadCrossMonthPosts` serves any cycle's post into the month its date lands in, and the grid
 * buckets by day). A post moved out of September's cycle into an October date is October's to
 * count, and an August-owned post moved onto 3 September fills that date. Counting by owner would
 * put the agent's arithmetic and the client's calendar into disagreement over the same month.
 */
export function monthFacts(month: string, items: readonly DatedItem[]): MonthFacts {
  const inMonth = items.filter((i) => typeof i.date === 'string' && i.date.slice(0, 7) === month);

  const perDate = new Map<string, number>();
  for (const i of inMonth) perDate.set(i.date, (perDate.get(i.date) ?? 0) + 1);

  const all = datesOf(month);
  // Built by walking the CALENDAR rather than the rows, so `occupied ∪ empty` is the month
  // exactly and neither list can contain a day the month does not have.
  const occupied = all.filter((d) => perDate.has(d));
  const empty    = all.filter((d) => !perDate.has(d));

  return {
    month,
    days:     all.length,
    total:    inMonth.length,
    occupied,
    empty,
    doubled:  occupied.filter((d) => (perDate.get(d) ?? 0) > 1).map((d) => ({ date: d, n: perDate.get(d)! })),
    byFormat: tally(inMonth, (i) => i.format || '(no format)'),
    byPillar: tally(inMonth, (i) => i.pillar || '(no pillar)'),
    byStatus: tally(inMonth, (i) => i.status || '(no status)'),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listTally = (t: readonly Tally[]) => (t.length ? t.map((x) => `${x.n} ${x.key}`).join(', ') : 'none');

/**
 * One month's facts as prompt lines.
 *
 * The empty-date list is printed IN FULL rather than counted. A count would be one more thing to
 * be trusted; the list is checkable against the rows below it, and "which days are free?" is the
 * question a client asks next anyway.
 *
 * A month with nothing in it says so in one line instead of printing thirty ISO dates nobody
 * needs — the only case where the list is longer than the fact it carries.
 */
export function factLines(label: string, f: MonthFacts): string[] {
  const head = `${label} (${f.month}):`;
  if (f.total === 0) {
    return [`${head} 0 posts. Every one of the month’s ${f.days} dates is EMPTY.`];
  }
  return [
    `${head} ${plural(f.total, 'post')}, on ${f.occupied.length} of the month’s ${f.days} dates.`,
    f.empty.length
      ? `  EMPTY DATES (${f.empty.length}): ${f.empty.join(', ')}.`
      : `  EMPTY DATES: none — every date in the month holds at least one post.`,
    f.doubled.length
      ? `  DATES HOLDING MORE THAN ONE POST: ${f.doubled.map((d) => `${d.date} (${d.n} posts)`).join(', ')}.`
        + ` Posts are NOT one per day in this month, so the number of posts is NOT the number of occupied dates.`
        + ` NEVER subtract posts from days to find empty dates — read the EMPTY DATES line above.`
      : `  DATES HOLDING MORE THAN ONE POST: none — every occupied date holds exactly one post.`,
    `  FORMATS: ${listTally(f.byFormat)}.`,
    `  PILLARS: ${listTally(f.byPillar)}.`,
    `  STATUS: ${listTally(f.byStatus)}.`,
  ];
}

/**
 * THE HEADING THE COUNTED LINES SIT UNDER.
 *
 * It is an instruction, not a label, because the model's default with a list in front of it is to
 * count the list. Being given the total is not enough on its own — it has to be told that the
 * counting is already done and that its own tally does not get to win. That is the same lesson
 * `weekLines` learned: naming the boundary did not stop the model deriving one until the words
 * said the derivation was forbidden.
 */
export const PLAN_FACTS_HEADING =
  `PLAN FACTS — ALREADY COUNTED FOR YOU. Every number below is computed from the plan itself and is exact.`
  + ` READ THEM OFF THESE LINES. Do NOT count the rows underneath, do NOT tally them yourself, and do NOT`
  + ` work out any figure that appears here — if a number is on this block, that number IS the answer, and`
  + ` a total you arrive at by counting is wrong. Each month is counted SEPARATELY: never quote one month's`
  + ` figure for another, and never add two months together unless the client asked about both.`;
