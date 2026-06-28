// Deterministic date formatting.
//
// `Date.prototype.toLocaleString` is NOT safe to use in code that renders on
// both the server and the client: even with an explicit locale, Node's ICU and
// the browser's ICU disagree on the date/time separator for `dateStyle` +
// `timeStyle` (Node emits "26 Jun 2026, 22:11", browsers emit
// "26 Jun 2026 at 22:11"), which triggers React hydration mismatches. The
// timezone also defaults to the host's, so server (usually UTC) and client
// (the viewer's local zone) can disagree on the actual time.
//
// These helpers assemble the string from explicit `Intl` parts with a pinned
// timezone and a separator we control, so the output is byte-for-byte identical
// server- and client-side.

const TIME_ZONE = 'Europe/London';

function parts(date: Date, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, ...opts });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** e.g. "26 Jun 2026, 22:11" — medium date + 24h time. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

/** e.g. "26/06/2026, 22:11" — numeric date + 24h time. */
export function formatDateTimeShort(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute}`;
}

/** e.g. "26 Jun 2026" — medium date only. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.day} ${p.month} ${p.year}`;
}

/** e.g. "26/06/2026" — numeric date only. */
export function formatDateShort(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.day}/${p.month}/${p.year}`;
}
