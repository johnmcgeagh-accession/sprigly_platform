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

export interface BuildSkeletonParams {
  month:       string;              // 'YYYY-MM' being planned
  history:     HistoryObservation;
  pillars:     PillarWeights;
  /** Cadence from client_planning_config, used only when history cannot supply one. */
  configPostsPerWeek?: number | null;
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
  const { month, history, pillars, configPostsPerWeek } = params;

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

  const slotCount = slotCountFor(month, postsPerWeek);

  const dates   = spreadDates(month, slotCount, reason ? [] : history.cadence.weekdays);
  const formats = spreadFormats(reason ? [] : history.formats, slotCount);
  const pillarNames = noPillars
    ? Array.from({ length: slotCount }, () => 'General')
    : spreadPillars(pillars.weights, slotCount);

  const slots: SkeletonSlot[] = dates.map((date, i) => ({
    date,
    format: formats[i] ?? 'single',
    pillar: pillarNames[i] ?? 'General',
  }));

  return {
    slots,
    basis: reason ? 'template' : 'observed',
    ...(reason ? { reason } : {}),
    cadenceBasis,
    pillarBasis: pillars.basis,
    formats: reason ? [] : history.formats,
  };
}
