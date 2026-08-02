/**
 * draft-recurring.ts — the client's standing commitments, resolved against what they ran.
 *
 * `client_planning_config.recurring_series` has held ivy-t's four standing features since
 * before the draft arc existed — Sunday Style (Sundays, 8pm, Carousel, Sprigly posts), the
 * Weekend Style Guide (Saturdays, 6pm, Carousel, Sally posts), Notes from the Founder and
 * What our customers see (both monthly). The old planner scheduled all four
 * (planning.ts:297). The draft assembler read the same config row for `pillars` and nothing
 * else, so September came out with none of them — the single largest visible difference
 * between a draft month and the June/July plans it replaced
 * (docs/reports/beat-grounding.md §2.4).
 *
 * Two jobs here, both deterministic and both pure:
 *
 *   RESOLVE — turn a configured series into something placeable: which weekday, which
 *   format, which of the client's authoritative categories it files under, and — from their
 *   own plan history — when it last ran and over how many months. That history is what makes
 *   the beat's rationale a fact ("last planned 19 July") rather than an assertion.
 *
 *   MATCH — decide which past plan post WAS an instance of a series. Category alone does not
 *   do it: ivy-t's Sunday Style and WSG posts carry categories of those names, but Notes from
 *   the Founder files under "Brand" and What our customers see under "Testimonials", so two of
 *   the four would read as never-run. Title matching covers those, category covers the rest,
 *   and a name's bracketed expansion counts as the name ("WSG" is "WSG (Weekend Style Guide)").
 *
 * NAMING. "Series" is already load-bearing in this codebase for a client INTENT — the
 * kind:'series' transform that expands "every Friday in August" into beats
 * (draft-transforms.ts, draft-series.test.ts). That is a sentence the client wrote about one
 * month. This is a standing configuration that outlives any month. Different things; this
 * module says "recurring" throughout so the two cannot be read as one.
 *
 * Pure. No db, no model.
 */
import type { RecurringSeries, SeriesDayOfWeek, SeriesFormat } from './types.js';

/** Configured day → JS weekday (0=Sun). `null` marks a monthly series, which has no day. */
const WEEKDAY_INDEX: Record<SeriesDayOfWeek, number | null> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  monthly: null,
};

/**
 * Configured format → the word content_cycle_posts.format uses.
 *
 * 'Reel or Carousel' and null both resolve to null, and that is not a gap: the config is
 * declining to fix the format, so the observed spread keeps its choice. Inventing one here
 * would overwrite a real signal with a guess.
 */
const FORMAT_WORD: Record<string, string | null> = {
  Reel: 'reel', Carousel: 'carousel', Static: 'single', 'Reel or Carousel': null,
};

export function recurringFormatWord(format: SeriesFormat): string | null {
  return format === null ? null : (FORMAT_WORD[format] ?? null);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `term` occur in `text` as a standalone name?
 *
 * Boundaries are alphanumeric lookarounds rather than `\b`, because a configured name can
 * begin or end with punctuation ("WSG (Weekend Style Guide)") and `\b` is defined against
 * word characters — it would anchor in the wrong place or not at all.
 */
export function mentionsTerm(text: string, term: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, 'i').test(text);
}

/**
 * The strings that count as naming a series.
 *
 * A configured name carries its own expansion — ivy-t's is literally
 * "WSG (Weekend Style Guide)" — and a title or category will use one side or the other, never
 * the parenthesised whole. So the full name, the part before the bracket, and the part inside
 * it are all the same series. Longest first, so a match reports the most specific form.
 */
export function seriesMatchTerms(name: string): string[] {
  const full = name.trim();
  const terms = new Set<string>([full]);
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(full);
  if (m) {
    if (m[1]?.trim()) terms.add(m[1].trim());
    if (m[2]?.trim()) terms.add(m[2].trim());
  }
  return [...terms].filter((t) => t.length > 0).sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** One past plan post, as the history read supplies it. NEVER a draft row — see loadSeriesHistory. */
export interface PlannedPostRef {
  date:     string;                 // 'YYYY-MM-DD'
  category: string | null;
  title:    string | null;
}

export interface SeriesObservation {
  /** The most recent date this series was planned, or null when it never has been. */
  lastPlanned:    string | null;
  /** Distinct 'YYYY-MM' buckets it appeared in — the sample behind lastPlanned. */
  monthsObserved: number;
}

/**
 * When did each series last run, and over how many months?
 *
 * A post is an instance of a series when its CATEGORY is one of the series' match terms, or
 * its TITLE names one. Category is checked first and is the stronger signal: it is a
 * structured field drawn from the client's authoritative category list, where a title is
 * prose. A post matching two series is credited to the first in name order, so the result
 * cannot depend on row order.
 *
 * Never-planned is `{ lastPlanned: null, monthsObserved: 0 }` — an absence, stated as one.
 */
export function observeSeriesHistory(
  names: readonly string[], posts: readonly PlannedPostRef[],
): Map<string, SeriesObservation> {
  const ordered = [...names].sort((a, b) => a.localeCompare(b));
  const terms = new Map(ordered.map((n) => [n, seriesMatchTerms(n)]));
  const months = new Map<string, Set<string>>(ordered.map((n) => [n, new Set<string>()]));
  const latest = new Map<string, string | null>(ordered.map((n) => [n, null]));

  for (const post of posts) {
    for (const name of ordered) {
      const hit = terms.get(name)!.some((t) =>
        (post.category != null && post.category.trim().toLowerCase() === t.toLowerCase())
        || (post.title != null && mentionsTerm(post.title, t)));
      if (!hit) continue;
      months.get(name)!.add(post.date.slice(0, 7));
      const prev = latest.get(name) ?? null;
      if (prev === null || post.date > prev) latest.set(name, post.date);
      break;                                  // credited once, to the first series in name order
    }
  }

  return new Map(ordered.map((n) => [n, {
    lastPlanned: latest.get(n) ?? null,
    monthsObserved: months.get(n)!.size,
  }]));
}

/**
 * The client's own shorthand for a series — the part before the bracket.
 *
 * Her config names the Weekend Style Guide "WSG (Weekend Style Guide)", carrying both forms in
 * one string, and every month she has ever run titles it by the short one: "WSG: Vests",
 * "WSG: Connie Violet", "WSG: Maggie Almond". Her own `categories` list agrees — it contains
 * "WSG", not the expansion — and so does `postingTimes.wsg`. Three independent places in her
 * configuration say the same thing, so a beat titled "WSG (Weekend Style Guide): Lydia" is
 * using our reading of her name rather than hers.
 *
 * A name with no bracket is already its own shorthand.
 */
export function seriesShortName(name: string): string {
  const full = name.trim();
  const m = /^(.*?)\s*\([^)]+\)\s*$/.exec(full);
  return m?.[1]?.trim() || full;
}

/** A configured recurring series, resolved against the client's own plan history. */
export interface ResolvedSeries {
  name:      string;
  /** What a title calls it: "WSG", where `name` is "WSG (Weekend Style Guide)". */
  shortName: string;
  /** As configured — 'Sunday' … 'Saturday' | 'monthly'. Carried verbatim into the evidence. */
  dayOfWeek: SeriesDayOfWeek;
  /** 0=Sun..6=Sat, or null for a monthly series. */
  weekday:   number | null;
  /** Plan format word, or null when the config declines to fix one. */
  format:    string | null;
  time:      string;
  whoPosts:  string;
  /** The client's own category for this series, or null when none of theirs matches. */
  category:  string | null;
  lastPlanned:    string | null;
  monthsObserved: number;
}

/**
 * Resolve configured series against the client's categories and their plan history.
 *
 * `categories` is documented as AUTHORITATIVE (schema.ts) — the planning worker may only use
 * values from that list — so a series files under one of the client's own categories or under
 * none. Deriving "Notes from the Founder" into a category of that name would put a value in
 * the column that the client's configuration does not contain.
 *
 * Sorted by name. The config array's order is a database row order, and a tie broken by it is
 * not determinism.
 */
export function resolveRecurringSeries(
  configured: readonly RecurringSeries[],
  categories: readonly string[],
  history:    readonly PlannedPostRef[],
): ResolvedSeries[] {
  const named = configured.filter((s) => typeof s?.name === 'string' && s.name.trim().length > 0);
  const observed = observeSeriesHistory(named.map((s) => s.name.trim()), history);

  return named
    .map((s) => {
      const name = s.name.trim();
      const terms = seriesMatchTerms(name);
      const category = categories.find((c) => terms.some((t) => c.trim().toLowerCase() === t.toLowerCase())) ?? null;
      const obs = observed.get(name) ?? { lastPlanned: null, monthsObserved: 0 };
      return {
        name,
        shortName: seriesShortName(name),
        dayOfWeek: s.dayOfWeek,
        weekday:   WEEKDAY_INDEX[s.dayOfWeek] ?? null,
        format:    recurringFormatWord(s.format),
        time:      s.time,
        whoPosts:  s.whoPosts,
        category,
        lastPlanned:    obs.lastPlanned,
        monthsObserved: obs.monthsObserved,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
