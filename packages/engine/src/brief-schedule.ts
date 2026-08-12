/**
 * brief-schedule.ts — read the dates the EXTRACTOR found back onto the reshape path.
 *
 * ── The defect this closes ───────────────────────────────────────────────────────────
 *
 * A wizard save runs two model passes over one sentence. `extractStructuredBrief` reads it
 * carefully — it resolves "the week before" into a real window, dates every beat, and records
 * the collisions it notices — and writes the result to `content_cycles.structured_brief`,
 * where the reshape path never looked. `classifyIntake` then re-derives a date from the raw
 * text per segment, and THAT is what placed the month. For "On the 12th we're going to launch
 * Hannah in green, can you write a teaser the week before" the extractor said 12 November and
 * the month got the 5th.
 *
 * This module is the bridge, and it is deliberately PURE: the caller loads the brief (it is
 * already in hand — the same request just wrote it), and this decides nothing about IO. No
 * third model call is involved; the answer was already paid for.
 *
 * ── How a segment is matched to a schedule entry ─────────────────────────────────────
 *
 * There is no id tying the two together, and no reliable way to invent one from text: the
 * brief is decomposed into VERBATIM segments while the schedule's `note` is the extractor's
 * own restatement, so substring matching fails on exactly the sentences that matter.
 *
 * The one key that IS reliable is the PRODUCT NAME. The extractor puts it on the entries that
 * carry one, and `classifyIntake` puts the same words in the intent's `subject`, because both
 * are reading the client naming their own product. Measured against ivy-t's live November
 * brief: `launch | Hannah | green | 2026-11-12` against the intent subject "Hannah in green" —
 * an unambiguous match, and the same for the Connie arc.
 *
 * Entries with NO product (`restock-announcement`, `behind-the-scenes`, `styling-tips`,
 * `giveaway`, `customer-story` — five of the thirteen on that same brief) have no key at all,
 * and they are also the ones that need no help: each is a single dated post whose segment says
 * "on the 16th" in words, which the classifier reads correctly. So they are left alone, which
 * is the "where the schedule does not name a date for this segment, current behaviour stands"
 * half of the rule.
 */

/** The three parts of a launch arc, as the brief dated them. Any may be absent. */
export interface BriefArcDates {
  launch?:   string;
  tease?:    string;
  followUp?: string;
}

/** One schedule entry, read defensively — this comes off a jsonb column. */
interface RawEntry {
  date?:      unknown;
  dateRange?: unknown;
  type?:      unknown;
  product?:   unknown;
  colourway?: unknown;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isoOrNull = (v: unknown): string | null => {
  const s = str(v);
  return s && ISO.test(s) ? s : null;
};

/** Which part of an arc an entry's `type` describes, or null for anything else.
 *
 *  `type` is a free-form kebab label the model chooses ("launch", "teaser", "follow-up",
 *  "build-up", "restock-announcement"), so this matches on substrings rather than an enum —
 *  an enum would be a contract the extractor was never given. */
export function arcRoleOf(type: string | null): keyof BriefArcDates | null {
  if (!type) return null;
  const t = type.toLowerCase();
  // Order matters: "relaunch-tease" is a tease, not a launch.
  if (t.includes('teas') || t.includes('build-up') || t.includes('buildup')) return 'tease';
  if (t.includes('follow')) return 'followUp';
  if (t.includes('launch')) return 'launch';
  return null;
}

/**
 * Does this entry's product name appear in the intent's subject?
 *
 * Word-boundary matching, lowercased. A bare `includes` would match "Ali" inside "Palia", and
 * a product name is exactly the kind of short token that collides.
 */
export function productMatchesSubject(product: string, subject: string): boolean {
  const p = product.toLowerCase().trim();
  if (!p) return false;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(subject);
}

/**
 * Resolve one entry to a single date.
 *
 * A single `date` is used as given. A `dateRange` is the extractor saying the client was
 * VAGUE ("the week before"), and which end to take depends on the part: the point of "a week
 * before" is the week, so the arc part sits at the edge FURTHEST from the launch. For a tease
 * window of 5–11 Nov against a 12 Nov launch that is the 5th; for a follow-up window of 13–19
 * it is the 19th. Symmetric, and it reproduces what the client actually asked for.
 *
 * With no launch to measure from, tease takes the start and follow-up the end — the same
 * answer by the same reasoning, without the arithmetic.
 */
export function entryDate(entry: RawEntry, role: keyof BriefArcDates, launchDate: string | null): string | null {
  const single = isoOrNull(entry.date);
  if (single) return single;

  const range = entry.dateRange as { start?: unknown; end?: unknown } | null | undefined;
  const start = isoOrNull(range?.start), end = isoOrNull(range?.end);
  if (!start || !end) return start ?? end;
  if (role === 'launch') return start;                     // a vague launch takes the window's open
  if (!launchDate) return role === 'tease' ? start : end;

  const far = (d: string) => Math.abs(Date.parse(d) - Date.parse(launchDate));
  return far(start) >= far(end) ? start : end;
}

/**
 * The launch-arc dates this brief holds for `subject`, if any.
 *
 * Degrades to `{}` on every failure mode the caller can hand it — a null brief (the 25s
 * extraction race timed out), a malformed one, a schedule that is not an array, an entry that
 * is not an object. Nothing here throws, because the save has already landed by the time this
 * runs and a placement improvement must never cost the client their brief.
 */
export function briefArcDatesFor(brief: unknown, subject: string): BriefArcDates {
  if (!brief || typeof brief !== 'object') return {};
  const schedule = (brief as { schedule?: unknown }).schedule;
  if (!Array.isArray(schedule)) return {};
  const subj = (subject ?? '').trim();
  if (!subj) return {};

  // Entries this subject owns, by product name, keeping the model's order.
  const mine: Array<{ role: keyof BriefArcDates; entry: RawEntry }> = [];
  for (const raw of schedule) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as RawEntry;
    const product = str(entry.product);
    if (!product || !productMatchesSubject(product, subj)) continue;
    const role = arcRoleOf(str(entry.type));
    if (role) mine.push({ role, entry });
  }
  if (mine.length === 0) return {};

  // The launch is resolved FIRST: the other two are measured against it.
  const launchEntry = mine.find((m) => m.role === 'launch');
  const launch = launchEntry ? entryDate(launchEntry.entry, 'launch', null) : null;

  const out: BriefArcDates = {};
  if (launch) out.launch = launch;
  for (const { role, entry } of mine) {
    if (role === 'launch' || out[role]) continue;          // first of each role wins
    const d = entryDate(entry, role, launch);
    if (d) out[role] = d;
  }
  return out;
}
