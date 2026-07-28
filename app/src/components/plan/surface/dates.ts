/**
 * dates.ts — the calendar arithmetic the mobile surface runs on.
 *
 * Every function here is pure and takes ISO 'YYYY-MM-DD' strings, never Date objects across
 * a boundary. That is deliberate: a `Date` carries a timezone, and the client's clock is not
 * trusted anywhere in this product — "today" is server-computed in London and arrives as a
 * string (usePlanData's `init.today`). Keeping the whole surface in strings means there is no
 * point at which a browser in Sydney can disagree with the gate that decides what is editable.
 *
 * Extracted from PlanMobile rather than rewritten: the same helpers, in one place, now that a
 * week strip, a month grid and a move picker all need them.
 */

export const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DOW_INITIAL = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
export const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local Date → ISO day. Only ever used on Dates this module made itself. */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO day → a local-midnight Date, for arithmetic only. */
export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** The Monday of the week containing `iso`. Weeks start Monday throughout — the strip, the
 *  grid and the day header all agree, which is what stops a date landing in two columns. */
export function mondayOf(iso: string): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toIso(d);
}

/** The seven ISO days of the week containing `iso`, Monday first. */
export function weekOf(iso: string): string[] {
  const mon = mondayOf(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/** 'YYYY-MM' of an ISO day. */
export const monthOf = (iso: string): string => iso.slice(0, 7);

/** Days in the month of 'YYYY-MM'. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y!, m!, 0).getDate();
}

/**
 * The month grid for 'YYYY-MM': whole weeks, Monday first, padded with the neighbouring
 * months' days so every row has seven cells. `inMonth` is what the surface greys out — the
 * padding days are real dates and stay tappable, because a client reaching for 1 November
 * from October's last row means it.
 */
export function monthGrid(month: string): { iso: string; day: number; inMonth: boolean }[] {
  const first = `${month}-01`;
  const start = mondayOf(first);
  const total = daysInMonth(month);
  const last = `${month}-${pad(total)}`;
  // Whole weeks from the Monday before the 1st to the Sunday after the last day.
  const endMon = mondayOf(last);
  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let iso = start; iso <= addDays(endMon, 6); iso = addDays(iso, 1)) {
    cells.push({ iso, day: fromIso(iso).getDate(), inMonth: monthOf(iso) === month });
  }
  return cells;
}

/** 'October 2026' for a 'YYYY-MM'. */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_FULL[(m ?? 1) - 1]} ${y}`;
}

/** 'Thursday 1 October' — the day header, spelled out. */
export function dayTitle(iso: string): string {
  const d = fromIso(iso);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${names[d.getDay()]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
}

/** '1 Oct' — compact, for a confirmation naming a destination. */
export function shortDate(iso: string): string {
  const d = fromIso(iso);
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]!.slice(0, 3)}`;
}

/**
 * Which day the surface should land on for a month: today when today is in it (so you open
 * on the current week), else the month's earliest post, else the 1st.
 *
 * This is what stops the "dumped on the 1st of a stale month" landing. Carried over from
 * PlanMobile unchanged — it was right, it just lived inside a component.
 */
export function defaultDayFor(month: string, today: string, dates: readonly string[]): string {
  if (monthOf(today) === month) return today;
  const inMonth = dates.filter((d) => monthOf(d) === month).sort();
  return inMonth[0] ?? `${month}-01`;
}
