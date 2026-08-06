/**
 * month-footer.ts — the one sentence under the month grid, split so part of it can be tapped.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A TEMPLATE LITERAL IN THE SURFACE ─────────────────
 *
 * It used to be one. Then it grew a second state (posts still being written), and now a third
 * (posts waiting on the client), and the three compose: a month can have both, and the numbers
 * can be equal, which is where the wording goes wrong quietly. "2 are still being written, and
 * 2 need a word from you" reads as ONE group of two described twice. `another` is what fixes it,
 * and a rule that subtle belongs somewhere it can be asserted rather than inside JSX.
 *
 * ── WHY IT RETURNS THREE PIECES ─────────────────────────────────────────────────────
 *
 * Because the ask has to be REACHABLE. Naming a count with no route to it is the same dead end
 * one layer up: the client reads "3 need a word from you" on a surface where the only
 * instruction about tapping ("Tap a day to open it") has just been replaced by that very
 * sentence. So `ask` is rendered as a control and the caller wires it to the first waiting post.
 * The split is here rather than in the caller so the punctuation either side of the control is
 * decided once, with the wording it belongs to.
 */

export interface MonthFooterParts {
  /** Everything before the tappable clause, including its leading space. */
  before: string;
  /** The tappable clause, or null when nothing is waiting on the client. */
  ask: string | null;
  /** Punctuation after the clause. Empty when there is no clause. */
  after: string;
}

export function monthFooterParts(opts: {
  /** Every post in the grid, whatever state it is in — the count is what EXISTS. */
  total: number;
  /** 'September' — the month word alone, as the surface already renders it. */
  monthWord: string;
  /** Posts genuinely being written. Banked and declined posts are not among them. */
  inFlight: number;
  /** Declined launch beats: written by nobody, waiting on an answer only the client has. */
  waiting: number;
}): MonthFooterParts {
  const { total, monthWord, inFlight, waiting } = opts;
  if (total === 0) return { before: `Nothing planned across ${monthWord} yet.`, ask: null, after: '' };

  const lead = `${total} post${total === 1 ? '' : 's'} across ${monthWord}.`;

  // Nothing happening and nothing wanted: the surface keeps its one instruction.
  if (inFlight === 0 && waiting === 0) return { before: `${lead} Tap a day to open it.`, ask: null, after: '' };

  const written = inFlight === 1 ? 'One is still being written' : `${inFlight} are still being written`;
  if (waiting === 0) return { before: `${lead} ${written}.`, ask: null, after: '' };

  // `another` is load-bearing when both clauses are present, and most of all when the two
  // numbers match: without it "2 are still being written, and 2 need a word from you" reads as
  // one group of two, described twice. Singular drops the numeral for the same reason English
  // does — "another needs" rather than "another 1 needs".
  const ask = inFlight === 0
    ? (waiting === 1 ? 'One needs a word from you' : `${waiting} need a word from you`)
    : (waiting === 1 ? 'another needs a word from you' : `another ${waiting} need a word from you`);

  return {
    before: inFlight === 0 ? `${lead} ` : `${lead} ${written}, and `,
    ask,
    after: '.',
  };
}
