/**
 * draft-assembly.ts — assemble a draft plan for a cycle.
 *
 * The inversion: instead of asking the client what they want and then generating a month,
 * we propose a month from what their own history says works, and ask them to react to it.
 * This module builds that proposal. It is DETERMINISTIC end to end — no model call lives
 * here (the phrasing pass is a separate, optional, non-blocking step).
 *
 * Every beat carries the evidence it was chosen on, as structured metric refs. Where the
 * evidence does not exist, the beat says so ({basis:'template'}) rather than borrowing
 * confidence it has not earned. A draft the client can argue with has to be a draft that
 * shows its reasoning.
 *
 * Assumptions are the OTHER half: the gaps the assembler noticed and could not fill (no
 * launch info, no catalogue, thin history). They become the questions the Ask email puts
 * to the client, which is what makes this an intake flow rather than a guess.
 */
import type { BeatMeta, BeatRationaleEvidence } from '@sprigly/db';
import { observeHistory, type HistoryPost, type HistoryObservation } from './draft-history.js';
import { resolvePillarWeights } from './pillar-weights.js';
import { buildSkeleton, DRAFT_MIN_POSTS, type Skeleton } from './draft-skeleton.js';
import { allocateSlots, type ExperimentCandidate, type AllocatedSlot } from './draft-allocator.js';
import type { ResolvedSeries } from './draft-recurring.js';
import { staleProducts, productBeatCap, type ProductCoverage } from './draft-coverage.js';
import { deriveTitle } from './draft-transforms.js';
import type { Pillar } from './types.js';

/** A single assembled beat, ready to persist as a status='draft' post row. */
export interface DraftBeat {
  scheduledDate: string;         // 'YYYY-MM-DD'
  format:        string;
  pillar:        string;
  position:      number;
  /** Deterministic title. The phrasing pass may replace it; it is never left empty. */
  title:         string;
  beatMeta:      BeatMeta;
  /**
   * The lossless per-post columns the workbook pipeline carries, for content_cycle_posts
   * .source_meta. The old planner wrote category / whoPosts / postingTime on every recurring
   * beat and the assembler wrote none of them, so a Sunday Style draft beat lost the three
   * facts that say who posts it and when (docs/reports/beat-grounding.md §1.5). Only ever the
   * fields a beat actually HAS — a beat with no series has no whoPosts, and gets none.
   */
  sourceMeta?: { category?: string; whoPosts?: string; postingTime?: string };
}

export interface DraftPlan {
  clientId:  string;
  cycleId:   string;
  channel:   string;
  /** 'YYYY-MM' the draft plans FOR (the cycle's month + 1). */
  month:     string;
  beats:     DraftBeat[];
  basis:     'observed' | 'template';
  /** Cycle-level assumptions — the union of what every beat flagged, deduped. */
  assumptions: string[];
  /** Set when the client's last IG trawl is older than STALE_TRAWL_DAYS. Never blocks. */
  staleTrawlWarning?: string;
}

/** How old the client's IG history may be before the draft records a warning. The draft
 *  still assembles and the Ask still sends (D2) — stale data is worth flagging, never
 *  worth withholding the client's month over. */
export const STALE_TRAWL_DAYS = 14;

/**
 * ── The title rule ───────────────────────────────────────────────────────────
 *
 * A beat title is a HEADLINE — `[series shorthand: ]subject` — not a sentence. The subject is
 * the product, the client's own idea, or the pillar, in that order of preference.
 *
 * THE FORMAT IS APPENDED ONLY WHEN NOTHING ELSE DISTINGUISHES THE BEAT. The " — Carousel"
 * suffix was never information: the format is on the card's tile, on the sheet's tile, and in
 * the row that leads with it. It exists to keep two same-pillar beats in one month from
 * reading identically. A title naming a product or quoting her own sentence is already
 * distinct, so it takes no suffix; a pillar-only or series-only title still does, because four
 * "Sunday Style" beats with nothing else to say would otherwise be four of the same line.
 *
 * The cap stays at 60 (TITLE_MAX, draft-transforms.ts) and was re-measured rather than
 * assumed: the draft card clamps its heading to two lines of 16.5px semibold on a ~350px
 * measure, which is very close to sixty characters. Shortening below that would give away
 * card space already paid for. What changed is the SHAPE — see experimentTitle.
 */

/** Deterministic beat title, used as-is until (and if) the phrasing pass replaces it. */
export function deterministicTitle(pillar: string, format: string): string {
  const f = format.charAt(0).toUpperCase() + format.slice(1);
  return `${pillar} — ${f}`;
}

/**
 * Title for a coverage slot: the product, and — when the slot is also a series instance —
 * the series it runs under.
 *
 * "Sunday Style: Claire" is not a shape invented here; it is what the old planner wrote and
 * what her feed has run every Sunday for months. A series beat naming its product is the
 * single most recognisable line in a Sprigly month, and it comes out of two structured facts
 * with nothing in between.
 */
export function coverageTitle(product: string, seriesShortName?: string): string {
  return seriesShortName ? `${seriesShortName}: ${product}` : product;
}

/**
 * Title for a recurring-series slot: the series' own name.
 *
 * The subject of a Sunday Style beat is Sunday Style. That the deterministic title says so —
 * rather than the phrasing pass being trusted to — is the point: phrasing may fail, and a
 * fallback month must still be a concrete month. It is the same reasoning experimentTitle
 * already applies to the client's own words.
 */
export function recurringTitle(seriesShortName: string, format: string): string {
  const f = format.charAt(0).toUpperCase() + format.slice(1);
  return `${seriesShortName} — ${f}`;
}

/**
 * Title for an experiment slot: the client's own idea, as a headline.
 *
 * Their words, never a paraphrase — the point of an experiment beat is that the client
 * recognises the thing they asked for. But "their words" and "their first sixty characters"
 * are not the same thing, and this used to take the second: the first LINE, then a hard
 * slice at 59. Two ways that went wrong on her real backlog:
 *
 *   MID-WORD    "A hard-working wardrobe of incredible organic cotton staple… — Reel" — cut
 *               inside "staples", and then handed a format suffix.
 *   BARE LABEL  one idea opens with the line "Weekend Style Guide:", a heading over a dated
 *               list on the lines below. First-line-only produced "Weekend Style Guide: —
 *               Carousel": a label, a dangling colon, and a separator with nothing after it.
 *
 * deriveTitle already solves both, and was built for exactly this input — ivy-t's own
 * briefing prose, pinned against the real stored strings (draft-title.test.ts). It takes the
 * first SUBSTANTIVE clause rather than the first line, so a bare label falls through cleanly;
 * it strips trailing enumerations and dangling separators; and it caps on a word boundary.
 * Two derivations of the same thing were one too many, and the one with tests against her own
 * data is the one to keep.
 *
 * No format suffix: her sentence is what distinguishes this beat. See the title rule above.
 */
export function experimentTitle(ideaContent: string): string {
  return deriveTitle(ideaContent);
}

/** Detect the gaps that become intake questions. Order is fixed for determinism. */
export function detectAssumptions(params: {
  history:       HistoryObservation;
  hasCatalogue:  boolean;
  hasBriefedLaunch: boolean;
  skeleton:      Skeleton;
  /** How many beats ended up carrying productCoverage. Drives the catalogue assumption. */
  productBeats?: number;
}): string[] {
  const { history, hasCatalogue, hasBriefedLaunch, skeleton, productBeats = 0 } = params;
  const out: string[] = [];

  if (!hasBriefedLaunch) {
    out.push('No launches or restocks are on record for this month — the draft assumes a business-as-usual month.');
  }
  // The assumption is about USE, not existence.
  //
  // It used to fire only when no catalogue row existed. ivy-t HAS one — 49 families, cached
  // since 1 July — so the line was suppressed on all thirty September beats while not one of
  // them named a product, because nothing downstream ever opened the blob. The client was told
  // by omission that products had been considered (docs/reports/beat-grounding.md §1.6). What
  // they need to know is whether this month names any, and if not, why not.
  if (productBeats === 0) {
    out.push(hasCatalogue
      ? 'No beat names a specific product this month — nothing in your catalogue has gone long enough without a mention to be worth featuring.'
      : 'No product catalogue is cached, so no beat names a specific product or colourway.');
  }
  if (skeleton.basis === 'template') {
    out.push(`Not enough posting history to plan from (${history.totalPosts} posts, ${DRAFT_MIN_POSTS} needed) — this month uses a neutral starting shape rather than observed patterns.`);
  }
  if (skeleton.basis === 'observed' && history.formatCoverage.typed < history.formatCoverage.total) {
    out.push(`Format mix is based on ${history.formatCoverage.typed} of ${history.formatCoverage.total} posts — the rest predate format tracking.`);
  }
  if (skeleton.pillarBasis === 'equal') {
    out.push('No pillar weights are on record, so the month splits evenly across pillars.');
  }
  for (const s of skeleton.unplacedSeries) {
    // A configured series with nowhere to sit is a real gap, and the client is the only one who
    // can close it — by adding a posting day or standing the series down. Silence here would
    // read as "we decided not to run it this month".
    out.push(`"${s.name}" runs on ${s.dayOfWeek === 'monthly' ? 'a monthly slot' : `${s.dayOfWeek}s`}, but this month has no slot there — it isn't in the draft.`);
  }
  return out;
}

/**
 * Decide which beats get a product, and which product.
 *
 * ELIGIBILITY: any slot that does not already have the client's own words on it. An
 * experiment slot is hers; overwriting its subject with our gap analysis would be the
 * machine talking over her, and replacementTier draws that same line.
 *
 * ORDER: recurring-series slots first, then the rest, each in slot order. This is not a
 * tidiness preference — it is what her months look like. "Sunday Style: Claire",
 * "WSG: Maggie Almond", "WSG: Connie Violet": the standing features are where a product gets
 * named, every week, and giving them the stalest products reproduces that shape exactly.
 *
 * CAP: productBeatCap. Stops a large stale catalogue from turning a month into a readthrough.
 *
 * Returns index → coverage. Fully determined by (slots, coverage, month).
 */
function assignCoverage(
  skeleton: Skeleton, allocation: AllocatedSlot[], coverage: readonly ProductCoverage[], month: string,
): Map<number, ProductCoverage> {
  const out = new Map<number, ProductCoverage>();
  const stale = staleProducts(coverage, month);
  if (stale.length === 0) return out;

  const isExperiment = (i: number) => allocation[i]?.slotType === 'experiment' && allocation[i]?.candidate;
  const eligible = [
    ...skeleton.slots.flatMap((s, i) => (s.series && !isExperiment(i) ? [i] : [])),
    ...skeleton.slots.flatMap((s, i) => (!s.series && !isExperiment(i) ? [i] : [])),
  ];

  const cap = Math.min(productBeatCap(skeleton.slots.length), stale.length, eligible.length);
  for (let n = 0; n < cap; n++) out.set(eligible[n]!, stale[n]!);
  return out;
}

/** Build the structured evidence for one slot. Never prose, never invented. */
function evidenceFor(
  slot: AllocatedSlot, skeleton: Skeleton, pillarShare: number | undefined,
  coverage: ProductCoverage | undefined,
): BeatRationaleEvidence {
  if (skeleton.basis === 'template') {
    // A configured series survives the template path. It is a fact about the client's
    // STANDING COMMITMENTS, not an inference from history, so thin history is no reason to
    // withhold it — and a Sunday Style beat that could not say it was Sunday Style would be
    // the assembler hiding the one thing about that slot it actually knows.
    const templateSeries = skeleton.slots[slot.index]?.series;
    return {
      basis: 'template',
      ...(skeleton.reason ? { reason: skeleton.reason } : {}),
      ...(templateSeries
        ? { seriesDue: {
            name: templateSeries.name,
            dayOfWeek: templateSeries.dayOfWeek,
            lastPlanned: templateSeries.lastPlanned,
            monthsObserved: templateSeries.monthsObserved,
          } }
        : {}),
      // Coverage is a fact about the CATALOGUE and the CAPTIONS, not about posting patterns.
      // Thin history makes the skeleton a template; it does not make "Jules has not appeared
      // in a caption since 3 February" any less true.
      ...(coverage ? { productCoverage: coverage } : {}),
      cadenceBasis: skeleton.cadenceBasis,
    };
  }
  const skelSlot = skeleton.slots[slot.index];
  const format = skelSlot?.format;
  const observed = skeleton.formats.find((f) => f.format === format);
  const series = skelSlot?.series;
  return {
    basis: 'observed',
    ...(series
      ? { seriesDue: {
          name: series.name,
          dayOfWeek: series.dayOfWeek,
          lastPlanned: series.lastPlanned,
          monthsObserved: series.monthsObserved,
        } }
      : {}),
    ...(coverage ? { productCoverage: coverage } : {}),
    ...(observed
      ? { formatEngagement: { format: observed.format, avgEngagement: observed.avgEngagement, posts: observed.posts } }
      : {}),
    ...(pillarShare !== undefined ? { pillarShare } : {}),
    cadenceBasis: skeleton.cadenceBasis,
    ...(slot.slotType === 'experiment' && slot.candidate && slot.rank && slot.of
      ? { candidateRank: {
          rank: slot.rank, of: slot.of, origin: slot.candidate.origin,
          ...(slot.candidate.lifecycle ? { lifecycle: slot.candidate.lifecycle } : {}),
        } }
      : {}),
    // Her sentence, carried so a surface can quote it. sourceRef points AT the row; a client
    // surface cannot go and fetch it. Same reasoning as client_input's `reason`.
    ...(slot.candidate
      ? { backlogIdea: { text: slot.candidate.content, givenAt: slot.candidate.givenAt ?? null } }
      : {}),
  };
}

export interface AssembleDraftParams {
  clientId: string;
  cycleId:  string;
  channel:  string;
  month:    string;                 // 'YYYY-MM' to plan FOR
  posts:    HistoryPost[];          // the client's ig_posts history
  pillars:  Pillar[];               // from client_planning_config
  /** The ideas backlog, from loadDurableInputs. NOT empty: ivy-t's September window returns
   *  twenty (six never used) — the old note claiming otherwise described a Phase 0 snapshot
   *  that stopped being true. See docs/reports/beat-grounding.md §2.5. */
  candidates: ExperimentCandidate[];
  temperature: number | null;
  hasCatalogue: boolean;
  hasBriefedLaunch: boolean;
  configPostsPerWeek?: number | null;
  /** A client-stated cadence floor (kind:'cadence'), as a month slot count. Raises the slot
   *  count when the client asked for more than history would produce; never lowers it. */
  floorSlots?: number | null;
  /** The client's configured recurring series, resolved against their plan history
   *  (resolveRecurringSeries). Each claims slots that already exist; none creates one. */
  series?: readonly ResolvedSeries[];
  /** Every usable catalogue product with its caption recency (observeProductCoverage), stalest
   *  first. The assembler decides which are stale enough for THIS month and how many fit. */
  productCoverage?: readonly ProductCoverage[];
  staleTrawlWarning?: string | undefined;
}

/**
 * Assemble the draft. Pure given its params — the caller does the database reads, so this
 * is directly testable and its determinism is a property of the function, not of a mock.
 */
export function assembleDraft(params: AssembleDraftParams): DraftPlan {
  const {
    clientId, cycleId, channel, month, posts, pillars, candidates, temperature,
    hasCatalogue, hasBriefedLaunch, configPostsPerWeek, floorSlots, series, productCoverage,
    staleTrawlWarning,
  } = params;

  const history = observeHistory(posts);
  const weights = resolvePillarWeights(pillars);
  const skeleton = buildSkeleton({
    month, history, pillars: weights,
    ...(configPostsPerWeek !== undefined ? { configPostsPerWeek } : {}),
    ...(floorSlots !== undefined ? { floorSlots } : {}),
    ...(series !== undefined ? { series } : {}),
  });

  // A slot a recurring series claimed already has a subject; experiments go among the rest.
  const claimed = new Set(skeleton.slots.flatMap((s, i) => (s.series ? [i] : [])));
  const allocation = allocateSlots(skeleton.slots.length, temperature, candidates, claimed);
  const coverageBySlot = assignCoverage(skeleton, allocation, productCoverage ?? [], month);
  const assumptions = detectAssumptions({
    history, hasCatalogue, hasBriefedLaunch, skeleton, productBeats: coverageBySlot.size,
  });
  const shareByPillar = new Map(weights.weights.map((w) => [w.name, w.share]));

  const beats: DraftBeat[] = skeleton.slots.map((slot, i) => {
    const alloc = allocation[i] ?? { index: i, slotType: 'proven' as const };
    const coverage = coverageBySlot.get(i);
    const beatMeta: BeatMeta = {
      slotType: alloc.slotType,
      rationaleEvidence: evidenceFor(alloc, skeleton, shareByPillar.get(slot.pillar), coverage),
      ...(alloc.candidate ? { sourceRef: alloc.candidate.id } : {}),
      ...(assumptions.length > 0 ? { assumptions } : {}),
    };
    // SUBJECT PRECEDENCE: her own words, then a standing commitment (with its product, if it
    // was given one), then a product, then the pillar. An experiment slot is hers and nothing
    // overwrites it — allocateSlots was given the claimed indices and assignCoverage skips
    // experiment slots, so the branches below cannot collide. The pillar is what is left when
    // a beat has no subject of its own, which is the honest description of it rather than a
    // failure to find one.
    const title = alloc.candidate
      ? experimentTitle(alloc.candidate.content)
      : coverage
        ? coverageTitle(coverage.product, slot.series?.shortName)
        : slot.series
          ? recurringTitle(slot.series.shortName, slot.format)
          : deterministicTitle(slot.pillar, slot.format);

    // The lossless columns the old planner wrote and the assembler dropped. Only what the
    // beat has: a slot with no series has no whoPosts and is given none.
    const sourceMeta = slot.series
      ? {
          ...(slot.series.category ? { category: slot.series.category } : {}),
          ...(slot.series.whoPosts ? { whoPosts: slot.series.whoPosts } : {}),
          ...(slot.series.time ? { postingTime: slot.series.time } : {}),
        }
      : undefined;

    return {
      scheduledDate: slot.date,
      format:        slot.format,
      pillar:        slot.pillar,
      position:      i,
      title,
      beatMeta,
      ...(sourceMeta && Object.keys(sourceMeta).length > 0 ? { sourceMeta } : {}),
    };
  });

  return {
    clientId, cycleId, channel, month, beats,
    basis: skeleton.basis,
    assumptions,
    ...(staleTrawlWarning ? { staleTrawlWarning } : {}),
  };
}
