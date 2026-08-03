/**
 * caption-overlap.ts — how much of what the client published is text Sprigly wrote.
 *
 * Two measures, per client + channel + calendar month:
 *
 *   ADOPTION   of the captions she published that month, the share that match a Sprigly caption.
 *   DIVERGENCE for the matched ones only, how much of the published text is NOT ours.
 *
 * They are deliberately independent. A post that matches nothing moves adoption and never
 * touches divergence; a post that matches loosely moves both. Folding an unmatched post into
 * divergence as "100% diverged" would make one number say two things and neither honestly.
 *
 * ── WHY THIS IS TEXTUAL, AND WHY IT STAYS THAT WAY ──────────────────────────────────────────
 *
 * There is no join. `ig_posts` carries five keys per post — timestamp, caption, likesCount,
 * commentsCount, mediaType — and no post id, no permalink, nothing that names OUR row. The only
 * candidate key is the date, and docs/reports/beat-grounding.md §3d measured that it does not
 * hold: over 2026-06-01 onwards, 44 dates carry both a plan post and an IG post, 15 carry an IG
 * post with no plan post, 18 the reverse, and several days carry more than one post. A date join
 * would silently attribute the wrong caption to the wrong beat.
 *
 * So the match is on the WORDS, and the constraint is permanent until the Meta Graph API lands
 * and gives us a real post id. Which means every number here is a FLOOR, not a measurement:
 * a caption she rewrote past the threshold reads as unmatched, and a caption two of our posts
 * could both explain is credited to whichever scores higher. It undercounts. It never overcounts
 * — except in the one way the chain below exists to close.
 *
 * Pure. No db, no clock, no React — the loader hands it rows and it returns numbers.
 */

/**
 * The share of a published caption that must be Sprigly's words before we call it ours.
 *
 * 0.85 is where the ad-hoc query of 2 August 2026 sat, and Ivy T's July separates cleanly around
 * it: the fourteen captions published before 13 July score 0.30–0.55 against everything we ever
 * wrote for her, and the ten matches from the 13th onward score 0.89–1.00. Nothing real sits in
 * between, so the exact cut matters less than having one — but it is named here, once, because a
 * literal 0.85 sprinkled through a scorer and a test is two numbers that can drift apart.
 */
export const ADOPTION_MATCH_THRESHOLD = 0.85;

/**
 * Words, lower-cased, punctuation and emoji dropped, order discarded.
 *
 * Hashtags survive as their bare word (`#linenlove` → `linenlove`) rather than being stripped.
 * She appends her own tag block to captions she otherwise pastes verbatim, and those tags are
 * genuinely not our text — dropping them would flatter the score. Measured both ways on the
 * July data: it moves no post across the threshold either way, so the honest choice is free.
 */
export function tokenise(text: string | null | undefined): string[] {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * What share of the PUBLISHED caption's words are present in the Sprigly one.
 *
 * DIRECTIONAL, with the published text as the denominator, because that is the only direction in
 * which `1 - overlap` means anything: "how much of what she posted is not ours". The other
 * direction answers "how much of our draft survived", which is a different question and not the
 * one the operator asked.
 *
 * MULTISET, not set: a caption that says "linen" four times and one that says it once are not
 * the same caption, and set intersection would call them identical on that word.
 *
 * An empty published caption scores 0 — it has no words of ours in it, and dividing by zero to
 * claim 1.00 would report a perfect match on nothing.
 */
export function captionOverlap(published: readonly string[], sprigly: readonly string[]): number {
  if (published.length === 0) return 0;
  return overlapOfCounts(counted(published), counted(sprigly));
}

/**
 * The same number, from word counts instead of word lists.
 *
 * `hits = Σ min(count_published(w), count_sprigly(w))` is the multiset intersection written
 * without the mutable decrementing copy the list form needs, which matters because the scorer
 * runs this tens of thousands of times: one caption against every variant of every plan post.
 * Counting each side ONCE and then summing minima took Ivy T's ten months from 247ms to 69ms
 * over the same 42,075 comparisons — the per-comparison allocation, not the arithmetic, was the
 * cost. The numbers are identical; only the map building went away.
 *
 * `captionOverlap` above stays as the readable definition and the two are asserted equal in the
 * tests, so the fast path can never quietly become a different measure.
 */
export interface WordCounts { counts: Map<string, number>; total: number }

export function counted(words: readonly string[]): WordCounts {
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return { counts, total: words.length };
}

export function overlapOfCounts(published: WordCounts, sprigly: WordCounts): number {
  if (published.total === 0) return 0;
  // Walk the SMALLER map: the result is symmetric in which side we iterate, and the published
  // caption is usually the shorter of the two once a scheduling note is on ours.
  const [outer, inner] = published.counts.size <= sprigly.counts.size
    ? [published.counts, sprigly.counts]
    : [sprigly.counts, published.counts];
  let hits = 0;
  for (const [w, n] of outer) {
    const m = inner.get(w);
    if (m !== undefined) hits += n < m ? n : m;
  }
  return hits / published.total;
}

/**
 * Every version of one planned post that SPRIGLY wrote — and nothing the client wrote.
 *
 * This is the correction that makes adoption mean what it says. `content_cycle_posts.caption` is
 * a SHARED artefact: the app's caption box writes the client's own typing straight into it
 * (`app/src/lib/mutations.ts` patchPost → `set.caption`), so on a post she has typed into, that
 * column holds HER words under OUR row. Matching a published caption against it would score her
 * own writing as our adoption. On Ivy T's July that single mistake is the difference between
 * 17 of 36 and 10 of 36 — seven of the seventeen "matches" were her text on both sides.
 *
 * So the pool is assembled from the things that can only be ours:
 *
 *   `baseline`  `source_meta.original.caption` — the generated caption, captured once and never
 *               overwritten by an edit or a regen (`app/src/lib/revert.ts`). Always ours.
 *   `reshapes`  every `post_edits.caption_after` where `passed` — an instructed rewrite. She
 *               asked, the model wrote. Still ours, and this is what the operator's refinement
 *               asks for: a caption we reshaped on her instruction is the product working, not
 *               drift, so its text belongs in the pool and its distance from the baseline must
 *               not be charged to divergence.
 *   `live`      the current caption — included ONLY when no `plan_activity` row records a
 *               `caption_saved` with `origin = 'user'` against this post. Untouched by her hand
 *               ⇒ still exactly what we generated or reshaped.
 *
 * A post with none of the three (typed over, no baseline, no reshape) contributes nothing and is
 * counted in `chainsWithoutSpriglyText` so the surface can say so rather than quietly shrink the
 * pool. Absence is a value.
 */
export interface SpriglyCaptionChain {
  postId:        string;
  scheduledDate: string;
  /** Ours, newest last. Empty ⇒ this post has no recoverable Sprigly text. */
  variants:      string[];
}

export interface PublishedCaption {
  /** ISO instant from `ig_posts.posts[].timestamp`. */
  timestamp: string;
  caption:   string | null;
}

export interface CaptionMatch {
  publishedAt: string;
  /** The winning chain, or null when nothing reached the threshold. */
  postId:      string | null;
  plannedFor:  string | null;
  /** Best overlap against ANY Sprigly variant of ANY post, 0–1. */
  overlap:     number;
  matched:     boolean;
}

/**
 * A month's answer, or the honest reason there isn't one.
 *
 * Three states, not a number with a footnote. "We have not trawled this month" and "she published
 * nothing we can read" and "0% of what she published was ours" are three different facts, and a
 * bare `0` says the third when it means one of the first two. This is the same distinction
 * `observeFormats` protects in the draft history (`draft-history.ts`) and the same one
 * `lastFeatured: null` protects in the beat evidence.
 */
export type MonthHealth =
  | { state: 'not_trawled'; month: string }
  | { state: 'no_captions'; month: string; published: number }
  | { state: 'no_plan';     month: string; published: number }
  | {
      state:      'measured';
      month:      string;
      /** Denominator: captions published this month. Never render the percentage without it. */
      published:  number;
      matched:    number;
      /** matched / published, 0–1. */
      adoption:   number;
      /** Mean of (1 - overlap) over MATCHED pairs only, 0–1. Null when nothing matched. */
      divergence: number | null;
      matches:    CaptionMatch[];
      /** Planned posts in the pool that hold no Sprigly text at all (see SpriglyCaptionChain). */
      chainsWithoutSpriglyText: number;
    };

/**
 * The pool, tokenised once.
 *
 * Built separately from scoring because a client's whole history is scored against the SAME
 * pool — ten months against one set of plan captions. Tokenising inside the month loop instead
 * re-does 22,000 words ten times over and costs 270ms where 30ms will do (measured on Ivy T:
 * `pnpm --filter @sprigly/worker client-health-measure ivy-t`). Build it once, pass it to every
 * month.
 */
export interface CaptionPool {
  entries:                  ReadonlyArray<{ chain: SpriglyCaptionChain; variants: WordCounts[] }>;
  /** Chains that yielded no Sprigly text at all — carried so a surface can say so. */
  chainsWithoutSpriglyText: number;
}

export function buildPool(chains: readonly SpriglyCaptionChain[]): CaptionPool {
  const entries = chains
    .map((chain) => ({
      chain,
      variants: chain.variants.map(tokenise).filter((t) => t.length > 0).map(counted),
    }))
    .filter((e) => e.variants.length > 0);
  return { entries, chainsWithoutSpriglyText: chains.length - entries.length };
}

export interface ScoreMonthInput {
  month:     string;                              // 'YYYY-MM'
  published: readonly PublishedCaption[];
  /** Either — `chains` is the convenience form and builds a pool per call. */
  pool?:     CaptionPool;
  chains?:   readonly SpriglyCaptionChain[];
  threshold?: number;
}

/**
 * Score one month.
 *
 * `published` is what the trawl holds for the month; pass an empty array only when a row EXISTS
 * and is empty — the caller distinguishes "no row" by passing `null` for the whole month, which
 * it renders as `not_trawled`. See `monthHealth` below for the entry point that does that.
 */
export function scoreMonth(input: ScoreMonthInput): MonthHealth {
  const threshold = input.threshold ?? ADOPTION_MATCH_THRESHOLD;
  const { month } = input;

  // A published post with no caption is not a caption she published. It leaves the denominator
  // rather than counting as an unmatched one — a reel posted with no words is not a decision to
  // write her own, and scoring it as adoption failure would be an accusation.
  const withCaptions = input.published.filter((p) => (p.caption ?? '').trim().length > 0);
  if (withCaptions.length === 0) {
    return { state: 'no_captions', month, published: input.published.length };
  }

  const { entries, chainsWithoutSpriglyText } = input.pool ?? buildPool(input.chains ?? []);
  if (entries.length === 0) return { state: 'no_plan', month, published: withCaptions.length };

  const matches: CaptionMatch[] = [];
  for (const p of withCaptions) {
    const words = counted(tokenise(p.caption));
    let best = 0;
    let bestChain: SpriglyCaptionChain | null = null;
    for (const { chain, variants } of entries) {
      for (const variant of variants) {
        const o = overlapOfCounts(words, variant);
        if (o > best) { best = o; bestChain = chain; }
      }
    }
    const matched = best >= threshold;
    matches.push({
      publishedAt: p.timestamp,
      postId:      matched ? bestChain?.postId ?? null : null,
      plannedFor:  matched ? bestChain?.scheduledDate ?? null : null,
      overlap:     best,
      matched,
    });
  }

  const matchedRows = matches.filter((m) => m.matched);
  // DIVERGENCE takes the best overlap across the whole chain, which is what makes an instructed
  // reshape free: the reshaped text is IN the pool, so a caption she published verbatim after
  // asking us to change it scores 1.00 against the reshape and contributes 0 divergence, even
  // though it sits far from the baseline. Only text that moved out of band — her own edit after
  // ours, or a rewrite she never asked us for — leaves a gap.
  const divergence = matchedRows.length
    ? matchedRows.reduce((sum, m) => sum + (1 - m.overlap), 0) / matchedRows.length
    : null;

  return {
    state:     'measured',
    month,
    published: withCaptions.length,
    matched:   matchedRows.length,
    adoption:  matchedRows.length / withCaptions.length,
    divergence,
    matches,
    chainsWithoutSpriglyText,
  };
}

/** `published: null` ⇒ no `ig_posts` row for the month at all. The one caller-visible way to
 *  say "we don't know" rather than "0%".
 *
 *  Takes a pool or the chains behind one. Scoring more than one month ⇒ pass a pool. */
export function monthHealth(
  month: string,
  published: readonly PublishedCaption[] | null,
  poolOrChains: CaptionPool | readonly SpriglyCaptionChain[],
  threshold?: number,
): MonthHealth {
  if (published === null) return { state: 'not_trawled', month };
  const base: ScoreMonthInput = Array.isArray(poolOrChains)
    ? { month, published, chains: poolOrChains }
    : { month, published, pool: poolOrChains as CaptionPool };
  return scoreMonth(threshold === undefined ? base : { ...base, threshold });
}

/** Percent, one decimal, for a surface that must never print a bare rounded integer over a
 *  denominator of 36 and imply precision it does not have. Null in ⇒ null out. */
export const asPercent = (v: number | null): number | null =>
  v === null ? null : Math.round(v * 1000) / 10;
