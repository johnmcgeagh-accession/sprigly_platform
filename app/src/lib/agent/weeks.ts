/**
 * agent/weeks.ts — what "this week" and "next week" MEAN, stated once.
 *
 * ── The failure this exists for (F1) ─────────────────────────────────────────────────
 *
 * Asked on Friday 31 July 2026, the agent answered about **7–13 August**. The correct answer is
 * Mon 3 – Sun 9 August. 7 August is today + 7, and 13 August is today + 13: a ROLLING SEVEN
 * DAYS, starting a week from now.
 *
 * Nothing in the code computed that. `bucketCycleState` has bucketed Monday-anchored weeks since
 * it was written, and it gets them right — but the query answerer reads only `cycleState.summary`
 * (`query.ts`), and the summary stated today, the plan's window and every post's date, and
 * **never stated where the week began**. So "next week" was left as arithmetic for a small model,
 * and it did the arithmetic the phrase most naively suggests. The buckets that held the correct
 * answer were computed on the line above and thrown away.
 *
 * The fix is the same one that closed the past-date inversion and the month boundary: **state the
 * answer instead of setting the exercise.** These windows are computed here, printed into both
 * prompts, and the model reads them off rather than deriving them.
 *
 * ── The definition ───────────────────────────────────────────────────────────────────
 *
 * A week runs **Monday to Sunday**, inclusive. That is the calendar this product already uses
 * everywhere a week is drawn — the week strip (`dates.ts` `weekStart`), the month grid's lead,
 * the desktop calendar, and the weekly session's `weekStart` — so a week the agent talks about
 * and a week the client can see are the same seven days.
 *
 *   THIS WEEK  the Monday on or before today, through the Sunday six days later.
 *   NEXT WEEK  the Monday after that one, through its Sunday.
 *
 * "Next week" is therefore NOT today + 7. On a Friday the two differ by four days; on a Sunday
 * they differ by six, and the naive reading lands in the week after the one the client meant.
 *
 * Pure — no db, no React. `today` is an ISO date, which is what every caller already holds.
 */

/** A calendar week, Monday to Sunday, both ends inclusive, both ISO. */
export interface WeekWindow {
  /** Monday, 'YYYY-MM-DD'. */
  from: string;
  /** Sunday, 'YYYY-MM-DD'. */
  to: string;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'YYYY-MM-DD' → local Date at midnight (never UTC — a UTC parse shifts the day west of GMT). */
function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

const fmt = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The Monday on or before `iso`. Sunday belongs to the week that STARTED six days earlier —
 *  `(getDay() + 6) % 7` maps Sun→6, Mon→0, which is the shift the whole surface uses. */
export function mondayOf(iso: string): string {
  const d = parse(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmt(d);
}

/** `iso` + n days, as ISO. Whole days, local — DST-safe. */
export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

/** This week and next week, as calendar weeks, from any day of any week. */
export function weekWindows(today: string): { thisWeek: WeekWindow; nextWeek: WeekWindow } {
  const mon = mondayOf(today);
  const nextMon = addDays(mon, 7);
  return {
    thisWeek: { from: mon, to: addDays(mon, 6) },
    nextWeek: { from: nextMon, to: addDays(nextMon, 6) },
  };
}

/** 'YYYY-MM-DD' → 'Mon 3 August'. */
export function dayLabel(iso: string): string {
  const d = parse(iso);
  return `${DOW[d.getDay()]!.slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The two lines both prompts carry.
 *
 * They are stated as ISO ranges AND as human dates: the ISO is what a date comparison uses, and
 * the human form is what stops the model paraphrasing the range back into a different one when
 * it writes the answer.
 *
 * The last sentence is the one that closes the failure. Naming the boundary is not enough on its
 * own — the model has to be told that the boundary is what the phrase means, because "next week"
 * has an everyday reading ("in a week's time") that is not the calendar one.
 */
export function weekLines(today: string): string {
  const { thisWeek, nextWeek } = weekWindows(today);
  return [
    `WEEKS RUN MONDAY TO SUNDAY. Today is ${dayLabel(today)}.`,
    `THIS WEEK is ${thisWeek.from} to ${thisWeek.to} (${dayLabel(thisWeek.from)} to ${dayLabel(thisWeek.to)}).`,
    `NEXT WEEK is ${nextWeek.from} to ${nextWeek.to} (${dayLabel(nextWeek.from)} to ${dayLabel(nextWeek.to)}).`,
    `"Next week" means THAT Monday-to-Sunday block — never "seven days from today". Read the dates off these lines; do not count forward from today.`,
  ].join('\n');
}
