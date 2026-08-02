/**
 * draft-skeleton.ts — the deterministic slot skeleton.
 *
 * Same inputs → same skeleton, always. No model call, no randomness, no Date.now():
 * every ordering has an explicit tiebreak, because a tie resolved by array position is a
 * tie resolved by database row order, and that is not determinism.
 *
 * The skeleton answers three questions per slot — WHEN, WHAT FORMAT, WHICH PILLAR — from
 * the client's own observed history. It answers none of them from a model, and it never
 * invents a metric it did not observe.
 *
 * Pure. No db, no model.
 */
import type { HistoryObservation, FormatObservation } from './draft-history.js';
import type { PillarWeights } from './pillar-weights.js';
import { spreadPillars } from './pillar-weights.js';
import type { ResolvedSeries } from './draft-recurring.js';

/**
 * Minimum classified posts for the observed path. Mirrors THIN_CAPTION_FLOOR = 15
 * (engine/src/onboarding/onboard.ts:28) — the floor onboarding already uses for "enough
 * signal to be indicative", chosen against ivy-t's live account. Below it, the assembler
 * does NOT scale its confidence down quietly; it switches to the template skeleton and
 * says so in every beat's evidence.
 */
export const DRAFT_MIN_POSTS = 15;

/** Neutral fallback mix when history cannot ground one. Deliberately unweighted by
 *  engagement — there is no engagement to weight it by. */
const TEMPLATE_FORMATS: ReadonlyArray<{ format: string; sharePct: number }> = [
  { format: 'single',   sharePct: 40 },
  { format: 'carousel', sharePct: 40 },
  { format: 'reel',     sharePct: 20 },
];

/** Default posting days when none were observed: Mon/Wed/Fri. */
const TEMPLATE_WEEKDAYS = [1, 3, 5];

export interface SkeletonSlot {
  /** ISO date, 'YYYY-MM-DD'. */
  date:   string;
  format: string;
  pillar: string;
  /** The configured recurring series that claimed this slot, if any. */
  series?: ResolvedSeries;
}

export interface Skeleton {
  slots:  SkeletonSlot[];
  basis:  'observed' | 'template';
  /** Set only when basis='template'. */
  reason?: string;
  /** What the slot count was derived from — carried into rationaleEvidence. */
  cadenceBasis: { postsPerWeek: number; source: 'observed' | 'config'; months: number };
  pillarBasis:  'derived' | 'equal';
  /** Per-format engagement actually observed, for rationaleEvidence. Empty on template. */
  formats: FormatObservation[];
  /** Configured series that found no slot to sit on — becomes an assumption, never a silence. */
  unplacedSeries: Array<{ name: string; dayOfWeek: string }>;
}

/** Days in a 'YYYY-MM' month. */
function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every ISO date in the month, ascending. */
function datesInMonth(month: string): string[] {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

const weekdayOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * Choose the dates. Honours the weekdays the client actually posts on: take as many of
 * their preferred weekdays as the cadence needs, keep only the month's dates falling on
 * those, then sample evenly across the month so the slots are spread rather than
 * front-loaded. Falls back to every date in the month if the preferred days cannot supply
 * enough slots — a full month is worth more than a strict weekday pattern.
 */
export function spreadDates(month: string, slotCount: number, weekdays: number[]): string[] {
  if (slotCount <= 0) return [];
  const all = datesInMonth(month);
  const weeks = all.length / 7;

  const preferred = weekdays.length > 0 ? weekdays : TEMPLATE_WEEKDAYS;
  const needed    = Math.max(1, Math.ceil(slotCount / weeks));
  const chosen    = new Set(preferred.slice(0, Math.min(needed, preferred.length)));

  let eligible = all.filter((d) => chosen.has(weekdayOf(d)));
  if (eligible.length < slotCount) eligible = all;      // pattern cannot fill the month

  // Even sample across the eligible days — deterministic, and never duplicates a date
  // while slotCount <= eligible.length.
  const out: string[] = [];
  for (let i = 0; i < slotCount; i++) {
    out.push(eligible[Math.min(eligible.length - 1, Math.floor((i * eligible.length) / slotCount))]!);
  }
  return out;
}

/**
 * Weight formats by observed share TILTED by observed engagement, then spread.
 *
 * The tilt factor is each format's average engagement relative to the mean, CLAMPED to
 * [0.5, 2]. The clamp is the point: an unclamped tilt lets one strong month of carousels
 * erase reels from the plan entirely, which is a recommendation the data cannot support
 * from n=8. Tilt toward what works; never let it eliminate a format the client actually
 * uses.
 */
export function spreadFormats(formats: FormatObservation[], slotCount: number): string[] {
  if (slotCount <= 0) return [];
  if (formats.length === 0) {
    return spreadPillars(TEMPLATE_FORMATS.map((f) => ({ name: f.format, share: f.sharePct / 100 })), slotCount);
  }

  const meanEngagement = formats.reduce((s, f) => s + f.avgEngagement, 0) / formats.length;
  const weighted = formats.map((f) => {
    const tilt = meanEngagement > 0
      ? Math.min(2, Math.max(0.5, f.avgEngagement / meanEngagement))
      : 1;
    return { name: f.format, share: (f.sharePct / 100) * tilt };
  });

  const total = weighted.reduce((s, w) => s + w.share, 0);
  const normalised = total > 0
    ? weighted.map((w) => ({ name: w.name, share: w.share / total }))
    : weighted.map((w) => ({ name: w.name, share: 1 / weighted.length }));

  return spreadPillars(normalised, slotCount);
}

/** How many slots the month gets, from observed cadence. Clamped to something a month
 *  can physically hold and a client can plausibly produce. */
export function slotCountFor(month: string, postsPerWeek: number): number {
  const weeks = daysInMonth(month) / 7;
  return Math.max(1, Math.min(daysInMonth(month), Math.round(postsPerWeek * weeks)));
}

/**
 * Turn a client-stated cadence into a month slot-count FLOOR.
 *
 * A weekly figure is scaled to the month's real week-count; a monthly figure is taken as-is.
 * When both are given the larger wins — a floor is the smallest number the client will accept,
 * so the more demanding of two stated floors is the binding one. Clamped to what the month can
 * physically hold, so "50 a week" cannot ask for more posts than there are days.
 */
export function cadenceFloorSlots(
  month: string, cadence: { postsPerWeek?: number | null | undefined; postsPerMonth?: number | null | undefined },
): number {
  const cap = daysInMonth(month);
  const fromWeek  = typeof cadence.postsPerWeek === 'number' && cadence.postsPerWeek > 0
    ? slotCountFor(month, cadence.postsPerWeek) : 0;
  const fromMonth = typeof cadence.postsPerMonth === 'number' && cadence.postsPerMonth > 0
    ? Math.min(cap, cadence.postsPerMonth) : 0;
  return Math.min(cap, Math.max(fromWeek, fromMonth));
}

/**
 * Give each configured recurring series the slots it is entitled to.
 *
 * THE RULE: a series OCCUPIES slots, it never adds them. The dates were chosen from observed
 * cadence before this function sees them and are not touched — a series claims a slot that
 * already exists on its own weekday, or it claims nothing and says so. Relocating a slot to
 * satisfy a series would move a date the client's own posting rhythm chose, which is a cadence
 * decision wearing a scheduling costume; it is deliberately not made here.
 *
 * WEEKLY series take every unclaimed slot falling on their weekday. MONTHLY series take one
 * slot each, evenly spaced through what remains — the same placement idiom allocateSlots uses
 * for experiments, and for the same reason: a standing monthly feature clustered at one end of
 * the month is not a monthly feature.
 *
 * Weekly runs before monthly so a fixed day always beats a floating one, and both iterate in
 * name order, so a contested day resolves the same way every time rather than by config array
 * position (which is a database row order).
 *
 * Returns the claims by slot index plus the names of any series that found nowhere to sit.
 */
export function claimSeriesSlots(
  dates: readonly string[], series: readonly ResolvedSeries[],
): { claims: Map<number, ResolvedSeries>; unplaced: Array<{ name: string; dayOfWeek: string }> } {
  const claims = new Map<number, ResolvedSeries>();
  const unplaced: Array<{ name: string; dayOfWeek: string }> = [];
  const byName = [...series].sort((a, b) => a.name.localeCompare(b.name));

  for (const s of byName.filter((x) => x.weekday !== null)) {
    const mine = dates
      .map((d, i) => ({ i, d }))
      .filter(({ i, d }) => !claims.has(i) && weekdayOf(d) === s.weekday);
    if (mine.length === 0) { unplaced.push({ name: s.name, dayOfWeek: s.dayOfWeek }); continue; }
    for (const { i } of mine) claims.set(i, s);
  }

  const monthly = byName.filter((x) => x.weekday === null);
  if (monthly.length > 0) {
    const free = dates.map((_, i) => i).filter((i) => !claims.has(i));
    // Evenly spaced across what is left, mirroring allocateSlots: for 2 of 22 → 5 and 16.
    const step = free.length / monthly.length;
    monthly.forEach((s, n) => {
      const at = free[Math.min(free.length - 1, Math.floor(n * step + step / 2))];
      if (at === undefined || claims.has(at)) { unplaced.push({ name: s.name, dayOfWeek: s.dayOfWeek }); return; }
      claims.set(at, s);
    });
  }

  return { claims, unplaced: unplaced.sort((a, b) => a.name.localeCompare(b.name)) };
}

export interface BuildSkeletonParams {
  month:       string;              // 'YYYY-MM' being planned
  history:     HistoryObservation;
  pillars:     PillarWeights;
  /** Cadence from client_planning_config, used only when history cannot supply one. */
  configPostsPerWeek?: number | null;
  /**
   * A client-stated cadence FLOOR (from a `kind:'cadence'` intake), as a month slot count.
   * The month is assembled to AT LEAST this many slots: a client telling us "7 a week"
   * outranks what their history happened to show. Never lowers the count — an instruction is
   * a floor, not a target. Clamped to the month's day-count downstream, same as any cadence.
   */
  floorSlots?: number | null;
  /**
   * The client's configured recurring series, resolved against their plan history.
   * Each claims slots that ALREADY EXIST; none creates one. See claimSeriesSlots.
   */
  series?: readonly ResolvedSeries[];
}

/**
 * Build the slot skeleton.
 *
 * Falls back to the template path when the client has fewer than DRAFT_MIN_POSTS of
 * history, or no pillars to spread across. The fallback is declared in `basis`/`reason`
 * and propagates into every beat's rationaleEvidence — a template beat must never read
 * as an observed one.
 */
export function buildSkeleton(params: BuildSkeletonParams): Skeleton {
  const { month, history, pillars, configPostsPerWeek, floorSlots, series } = params;

  const thin = history.totalPosts < DRAFT_MIN_POSTS;
  const noPillars = pillars.weights.length === 0;
  const reason = thin
    ? `insufficient history: ${history.totalPosts} posts, floor is ${DRAFT_MIN_POSTS}`
    : noPillars
      ? 'no pillars configured for this client'
      : null;

  // Cadence: observed if we have it, else the client's configured rate, else a neutral 3/wk.
  const observedRate = history.cadence.postsPerWeek;
  const useObservedRate = !thin && observedRate > 0;
  const postsPerWeek = useObservedRate
    ? observedRate
    : (typeof configPostsPerWeek === 'number' && configPostsPerWeek > 0 ? configPostsPerWeek : 3);
  const cadenceBasis = {
    postsPerWeek,
    source: (useObservedRate ? 'observed' : 'config') as 'observed' | 'config',
    months: history.cadence.months,
  };

  // The observed/config cadence sets the count, then a client-stated floor raises it — never
  // lowers it — and the month's day-count caps it. A floor is the one signal that outranks
  // history: the client told us how much they want, and that beats what they used to do.
  const floor = typeof floorSlots === 'number' && floorSlots > 0 ? Math.min(daysInMonth(month), floorSlots) : 0;
  const slotCount = Math.max(slotCountFor(month, postsPerWeek), floor);

  const dates   = spreadDates(month, slotCount, reason ? [] : history.cadence.weekdays);
  const formats = spreadFormats(reason ? [] : history.formats, slotCount);
  const pillarNames = noPillars
    ? Array.from({ length: slotCount }, () => 'General')
    : spreadPillars(pillars.weights, slotCount);

  // Recurring series claim slots that already exist. The date list above is UNTOUCHED by
  // this — slot count, cadence and posting days are settled before a series is consulted.
  const { claims, unplaced } = series && series.length > 0
    ? claimSeriesSlots(dates, series)
    : { claims: new Map<number, ResolvedSeries>(), unplaced: [] as Array<{ name: string; dayOfWeek: string }> };

  const slots: SkeletonSlot[] = dates.map((date, i) => {
    const claimed = claims.get(i);
    return {
      date,
      // A claimed slot takes the series' declared format; where the config declines to fix one
      // ('Reel or Carousel', or null), the observed spread keeps its choice. Unclaimed slots
      // are untouched, so the format the history chose for them does not move because a series
      // was placed somewhere else in the month.
      format: claimed?.format ?? formats[i] ?? 'single',
      pillar: pillarNames[i] ?? 'General',
      ...(claimed ? { series: claimed } : {}),
    };
  });

  return {
    slots,
    basis: reason ? 'template' : 'observed',
    ...(reason ? { reason } : {}),
    cadenceBasis,
    pillarBasis: pillars.basis,
    formats: reason ? [] : history.formats,
    unplacedSeries: unplaced,
  };
}
