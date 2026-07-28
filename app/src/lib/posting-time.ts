/**
 * posting-time.ts — reading a post's posting time honestly.
 *
 * PURE, and in its own module rather than in plan.ts, because plan.ts pulls in @sprigly/db and
 * this has to be testable offline — and because the parsing rules below are a fact about the
 * stored data, not about the reader that happens to use them.
 */

/**
 * What a post's posting time actually looks like on disk, and what to show for it.
 *
 * `source_meta.postingTime` is NOT a clock value. Reading the live rows before writing this:
 * the stored values are `6am`, `6pm`, `7am`, `7pm`, `8pm`, `evening`, `Evening`, `Morning`.
 * Some are times and some are NAMED SLOTS — which is exactly what the `PostingTimes` contract
 * describes (a map of launch / morning / evening / wsg / sundayStyle), and what every mockup
 * quietly assumed away by showing "6:00" everywhere.
 *
 * So the surface renders a LABEL, not a time:
 *
 *   a clock form   `6am`, `6:00`, `06:00`, `18.00`  →  'HH:MM', 24-hour, tabular
 *   a named slot   `evening`, `Morning`             →  'Evening', 'Morning'
 *   anything else                                   →  null, and the card states no time
 *
 * Inventing a clock value for "Evening" would be putting a number on the surface that exists
 * nowhere in the data; dropping it would lose a fact the client's plan genuinely carries.
 */
const NAMED_SLOT = /^[a-z][a-z ]{1,14}$/i;

export function normalisePostingTime(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;

  // 6am / 6 pm / 11:30pm
  const meridiem = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?$/i.exec(v);
  if (meridiem) {
    let h = Number(meridiem[1]);
    const min = Number(meridiem[2] ?? '0');
    if (h < 1 || h > 12 || min > 59) return null;
    if (meridiem[3]!.toLowerCase() === 'p' && h !== 12) h += 12;
    if (meridiem[3]!.toLowerCase() === 'a' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  // 6:00 / 06:00 / 18.00
  const clock = /^(\d{1,2})[:.](\d{2})$/.exec(v);
  if (clock) {
    const h = Number(clock[1]);
    const min = Number(clock[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  // A named slot. Title-cased so 'evening' and 'Evening' are one label rather than two.
  if (NAMED_SLOT.test(v)) return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return null;
}

/** Is this label a clock time (rather than a named slot)? The move sheet's free `time` input
 *  can only round-trip the former. */
export function isClockTime(label: string | null): boolean {
  return !!label && /^\d{2}:\d{2}$/.test(label);
}
