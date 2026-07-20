/**
 * draft-history.ts — the deterministic observations the draft assembler plans from.
 *
 * Everything here is derived from the client's OWN stored ig_posts: how often they post,
 * which formats they use, which formats earn engagement, and which weekdays they favour.
 * No model call, no competitor data, no config guesses.
 *
 * ig_posts stores exactly five keys per post — timestamp, caption, likesCount,
 * commentsCount, mediaType — verified against the live table in the Phase 0 report (I-4
 * §2). There is no post id, no permalink, no views/saves/shares: `videoViewCount` IS
 * returned by Apify but dropped by every writer. So "engagement" here can only mean
 * likes + comments, matching how the rest of the codebase defines it (lean-line.ts:229,
 * planning.ts:347). Reels are therefore judged on the one signal reels are worst served
 * by — a real limitation, recorded rather than papered over.
 *
 * `mediaType` is ALSO absent on rows written before it existed (ivy-t: 19 of 50 posts
 * carry it). Format observations are computed over typed posts only and report their own
 * coverage, so a caller can tell "no reels" from "we cannot see the formats".
 *
 * Pure functions over already-loaded rows. The db read lives in the assembler.
 */

/** One stored ig_posts element. Only the fields that actually exist. */
export interface HistoryPost {
  timestamp:     string;            // ISO
  caption?:      string;
  likesCount:    number;
  commentsCount: number;
  mediaType?:    string;            // 'image' | 'reel' | 'carousel' — absent on older rows
}

export interface FormatObservation {
  format:        string;            // 'reel' | 'carousel' | 'single'
  posts:         number;
  sharePct:      number;            // share of TYPED posts, 0–100
  avgEngagement: number;            // mean (likes + comments), 1dp
}

export interface CadenceObservation {
  postsPerWeek: number;             // 2dp
  postCount:    number;
  months:       number;             // distinct YYYY-MM buckets observed
  /** Weekday numbers (0=Sun) the client actually posts on, most-used first. */
  weekdays:     number[];
}

export interface HistoryObservation {
  cadence:        CadenceObservation;
  formats:        FormatObservation[];
  /** Posts carrying a mediaType / total posts. Below 1 the format mix is a sample. */
  formatCoverage: { typed: number; total: number };
  totalPosts:     number;
}

/** ig_posts stores Apify's media types; content_cycle_posts.format uses its own words. */
const FORMAT_MAP: Record<string, string> = { image: 'single', reel: 'reel', carousel: 'carousel' };

const engagementOf = (p: HistoryPost): number => (p.likesCount ?? 0) + (p.commentsCount ?? 0);

/** Round to `dp` decimal places without float drift surprising a determinism test. */
const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Observe posting cadence. Mirrors computeCadence's arithmetic (onboard.ts:81-101)
 * INCLUDING its ≥1-week clamp, so the two can never disagree about the same history.
 *
 * That clamp matters more here than at onboarding: it treats any window under 7 days as
 * a full week, which deflates the rate for a short window. Onboarding looks at months of
 * history; a per-cycle assembler may be handed a single sparse month. The caller decides
 * whether the history is thick enough (see DRAFT_MIN_POSTS) — this function does not
 * silently compensate.
 */
export function observeCadence(posts: HistoryPost[]): CadenceObservation {
  if (posts.length === 0) return { postsPerWeek: 0, postCount: 0, months: 0, weekdays: [] };

  const times = posts.map((p) => Date.parse(p.timestamp)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (times.length === 0) return { postsPerWeek: 0, postCount: posts.length, months: 0, weekdays: [] };

  const windowDays = (times[times.length - 1]! - times[0]!) / 86_400_000;
  const weeks      = Math.max(windowDays / 7, 1);          // ≥1 week, as onboard.ts does
  const months     = new Set(posts.map((p) => p.timestamp.slice(0, 7))).size;

  // Weekday preference, most-used first; ties by weekday number so it is deterministic.
  const byDay = new Map<number, number>();
  for (const t of times) {
    const d = new Date(t).getUTCDay();
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const weekdays = [...byDay.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([day]) => day);

  return { postsPerWeek: round(times.length / weeks, 2), postCount: posts.length, months, weekdays };
}

/**
 * Observe the format mix and per-format engagement — the I-1 candidate query, in code.
 *
 * Computed over TYPED posts only (those carrying a mediaType). A format the client has
 * never posted is ABSENT from the result, not present with zero: "no reels observed" and
 * "reels performed at zero" are different claims and the assembler must not conflate
 * them. Sorted by post count then name, so the order is deterministic.
 */
export function observeFormats(posts: HistoryPost[]): { formats: FormatObservation[]; coverage: { typed: number; total: number } } {
  const typed = posts.filter((p) => typeof p.mediaType === 'string' && FORMAT_MAP[p.mediaType]);
  const coverage = { typed: typed.length, total: posts.length };
  if (typed.length === 0) return { formats: [], coverage };

  const buckets = new Map<string, HistoryPost[]>();
  for (const p of typed) {
    const format = FORMAT_MAP[p.mediaType!]!;
    const bucket = buckets.get(format);
    if (bucket) bucket.push(p);
    else buckets.set(format, [p]);
  }

  return {
    formats: [...buckets.entries()]
      .map(([format, group]) => ({
        format,
        posts:         group.length,
        sharePct:      round((group.length / typed.length) * 100, 1),
        avgEngagement: round(group.reduce((s, p) => s + engagementOf(p), 0) / group.length, 1),
      }))
      .sort((a, b) => b.posts - a.posts || a.format.localeCompare(b.format)),
    coverage,
  };
}

/** Observe everything the assembler needs from one history window. */
export function observeHistory(posts: HistoryPost[]): HistoryObservation {
  const { formats, coverage } = observeFormats(posts);
  return {
    cadence:        observeCadence(posts),
    formats,
    formatCoverage: coverage,
    totalPosts:     posts.length,
  };
}
