/**
 * draft-coverage.ts — which of the client's own products the month has stopped talking about.
 *
 * The catalogue has been cached for ivy-t since 2026-07-01: 49 families, parsed from their
 * sales export, with colourways and units sold. The draft assembler queried
 * client_product_catalogue and selected `id` — an existence probe on a 9.6 kB blob it never
 * opened (docs/reports/beat-grounding.md §2.1). Nine months of captions sat in the same
 * process, mapped into HistoryPost and never read. Put those two together and a beat can say
 * something no pillar ever could: *Jules — not featured since 3 February.*
 *
 * ── The only hard part is knowing when a word is a product ────────────────────
 *
 * "Joy" is a real ivy-t product family. It is also a word she writes: of five captions
 * matching it, four say "pure joy". "Ivy" is the brand, in 84 captions. "Sally" is a
 * sweatshirt AND the founder, who signs her posts. A matcher that counts all of those is not
 * measuring product coverage, it is measuring the English language, and it fails in the
 * direction that matters: an inflated `mentions` makes a neglected product look fresh, so the
 * beat that should have featured it never appears.
 *
 * Three guards, every one derived from the client's own data rather than a word list:
 *
 *   BRAND      — deriveBrandTokens(clients.name) already exists for exactly this
 *                (validate-catalogue.ts) and is passed in. "Ivy" goes.
 *   CASE       — catalogue names are proper nouns and she capitalises them without
 *                exception. Across 276 ivy-t captions, every product name but Ivy, Joy and
 *                Rose has ZERO lowercase occurrences. So matching is case-SENSITIVE, which
 *                separates "Joy" the product from "pure joy" at no cost to the other 40.
 *   AMBIGUOUS  — and a name she ALSO writes in lower case at all is dropped from the beat
 *                vocabulary entirely. Not because the case rule would miscount it, but
 *                because the phrasing validator must not reject an honest title for using an
 *                ordinary word.
 *
 * One residue is recorded rather than solved: a product name that is also a person's name
 * ("Sally") is counted whenever she signs off, so its `mentions` is inflated and it is
 * therefore never picked as stale. That is an UNDER-claim — the product simply does not get a
 * beat — which is the safe direction, and the count travels with the evidence so the number
 * can be judged. Guessing at which "Sally" is the sweatshirt would be the unsafe direction.
 *
 * ABSENCE IS A VALUE. `lastFeatured: null` means never featured. It is a stronger claim than
 * any date and it is never a zero, never an epoch, never an empty string.
 *
 * Pure. No db, no model.
 */
import type { HistoryPost } from './draft-history.js';

/** What a beat says about the product it was given. */
export interface ProductCoverage {
  product:      string;
  /** ISO date of the most recent caption naming it, or null when no caption ever has. */
  lastFeatured: string | null;
  /** Captions naming it — the sample behind lastFeatured. 0 when never featured. */
  mentions:     number;
}

/** A catalogue name deliberately kept out of the beat vocabulary, and why. */
export interface ExcludedName {
  name:   string;
  reason: 'brand' | 'ambiguous' | 'parse-artefact';
}

/**
 * How long a product may go unmentioned before the draft offers to feature it.
 *
 * Ninety days is a season. Below it a "neglected" product is usually just one she covered
 * last month; above it the list gets long enough to swamp a month before the cap does any
 * work. The THRESHOLD is a policy and it is stated here; the CLAIM a beat makes is the date
 * itself ("not featured since 3 February"), which the client can judge without knowing this
 * number at all.
 */
export const PRODUCT_STALE_DAYS = 90;

/**
 * The most of a month that may be given over to product-coverage beats.
 *
 * A third. Ivy-t's catalogue has 49 families and roughly twenty of them are stale at any
 * time; without a ceiling the assembler would hand every free slot a product and propose a
 * catalogue readthrough. A third leaves room for the pillars, her backlog, and the beats that
 * are about the brand rather than the range.
 */
export const PRODUCT_COVERAGE_SHARE = 1 / 3;

/** Distinct product-family names from a cached catalogue blob, defensively. Sorted. */
export function catalogueProductNames(catalogue: unknown): string[] {
  const families = (catalogue as { families?: unknown } | null | undefined)?.families;
  if (!Array.isArray(families)) return [];
  const names = new Set<string>();
  for (const f of families) {
    const n = (f as { name?: unknown } | null)?.name;
    if (typeof n === 'string' && n.trim().length > 0) names.add(n.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, CASE-SENSITIVE. See the header: case is the guard, not an accident. */
const namesProduct = (caption: string, name: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`).test(caption);

/** Does she write this name ALL IN LOWER CASE anywhere? Then it is a word before it is a product. */
const writtenAsAWord = (caption: string, name: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9])${escapeRe(name.toLowerCase())}(?![A-Za-z0-9])`).test(caption);

/**
 * Is `short` a whole-word prefix of `long`?
 *
 * The catalogue parser occasionally splits a style modifier into the name — ivy-t's families
 * include both "Erin" and "Erin Midweight". The longer one is an artefact of the same family
 * and has no captions of its own, so it would present as never-featured and win the staleness
 * ranking outright. Dropping it is the fix; keeping the shorter, real name is the point.
 */
const isPrefixOf = (short: string, long: string): boolean =>
  short.length < long.length && new RegExp(`^${escapeRe(short)}(?![A-Za-z0-9])`, 'i').test(long);

export interface CoverageResult {
  /** One entry per usable catalogue name, stalest first. */
  coverage: ProductCoverage[];
  /** Names kept out of the vocabulary, and why. Reported, never silently dropped. */
  excluded: ExcludedName[];
}

/**
 * Observe how recently each catalogue product appeared in the client's own captions.
 *
 * Sorted stalest-first: never featured, then oldest date, then by name so the order is total.
 * `posts` is the SAME array the history observation already holds — this costs no I/O.
 */
export function observeProductCoverage(params: {
  names:       readonly string[];
  posts:       readonly HistoryPost[];
  brandTokens: ReadonlySet<string>;
}): CoverageResult {
  const { names, posts, brandTokens } = params;
  const captions = posts
    .filter((p): p is HistoryPost & { caption: string } => typeof p.caption === 'string' && p.caption.length > 0);

  const excluded: ExcludedName[] = [];
  const usable: string[] = [];

  for (const name of names) {
    if (brandTokens.has(name.toLowerCase())) { excluded.push({ name, reason: 'brand' }); continue; }
    if (names.some((other) => other !== name && isPrefixOf(other, name))) {
      excluded.push({ name, reason: 'parse-artefact' }); continue;
    }
    // "pure joy" — she writes this one in lower case, so it is a word before it is a product.
    if (name !== name.toLowerCase() && captions.some((p) => writtenAsAWord(p.caption, name))) {
      excluded.push({ name, reason: 'ambiguous' }); continue;
    }
    usable.push(name);
  }

  const coverage: ProductCoverage[] = usable.map((product) => {
    let mentions = 0;
    let lastFeatured: string | null = null;
    for (const p of captions) {
      if (!namesProduct(p.caption, product)) continue;
      mentions++;
      const day = p.timestamp.slice(0, 10);
      if (lastFeatured === null || day > lastFeatured) lastFeatured = day;
    }
    return { product, lastFeatured, mentions };
  });

  // Stalest first: never featured, then oldest, then name. A total order, so the same
  // catalogue and the same captions always choose the same products.
  coverage.sort((a, b) => {
    if ((a.lastFeatured === null) !== (b.lastFeatured === null)) return a.lastFeatured === null ? -1 : 1;
    if (a.lastFeatured !== null && b.lastFeatured !== null && a.lastFeatured !== b.lastFeatured) {
      return a.lastFeatured < b.lastFeatured ? -1 : 1;
    }
    return a.product.localeCompare(b.product);
  });

  return { coverage, excluded: excluded.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** ISO 'YYYY-MM-DD' `days` before the first of `month`. */
function daysBeforeMonth(month: string, days: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The products stale enough to be worth a beat in `month`, stalest first.
 *
 * Never-featured always qualifies. A dated one qualifies once it has gone PRODUCT_STALE_DAYS
 * without a caption, measured back from the first of the plan month — the month being
 * proposed, not the month doing the proposing.
 */
export function staleProducts(coverage: readonly ProductCoverage[], month: string): ProductCoverage[] {
  const cutoff = daysBeforeMonth(month, PRODUCT_STALE_DAYS);
  return coverage.filter((c) => c.lastFeatured === null || c.lastFeatured < cutoff);
}

/** How many beats of a `slotCount` month may carry a product. At least one whenever any slot exists. */
export function productBeatCap(slotCount: number): number {
  return slotCount <= 0 ? 0 : Math.max(1, Math.floor(slotCount * PRODUCT_COVERAGE_SHARE));
}
