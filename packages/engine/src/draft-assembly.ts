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

/** Deterministic beat title, used as-is until (and if) the phrasing pass replaces it. */
export function deterministicTitle(pillar: string, format: string): string {
  const f = format.charAt(0).toUpperCase() + format.slice(1);
  return `${pillar} — ${f}`;
}

/**
 * Title for a recurring-series slot: the series' own name.
 *
 * The subject of a Sunday Style beat is Sunday Style. That the deterministic title says so —
 * rather than the phrasing pass being trusted to — is the point: phrasing may fail, and a
 * fallback month must still be a concrete month. It is the same reasoning experimentTitle
 * already applies to the client's own words.
 */
export function recurringTitle(seriesName: string, format: string): string {
  const f = format.charAt(0).toUpperCase() + format.slice(1);
  return `${seriesName} — ${f}`;
}

/** Title for an experiment slot: the client's own idea, trimmed to a title's length.
 *  Their words, not a paraphrase — the point of an experiment beat is that the client
 *  recognises the thing they asked for. */
export function experimentTitle(ideaContent: string, format: string): string {
  const f = format.charAt(0).toUpperCase() + format.slice(1);
  const firstLine = ideaContent.split(/\n/)[0]?.trim() ?? '';
  const idea = firstLine.length > 60 ? `${firstLine.slice(0, 59)}\u2026` : (firstLine || 'New idea');
  return `${idea} — ${f}`;
}

/** Detect the gaps that become intake questions. Order is fixed for determinism. */
export function detectAssumptions(params: {
  history:       HistoryObservation;
  hasCatalogue:  boolean;
  hasBriefedLaunch: boolean;
  skeleton:      Skeleton;
}): string[] {
  const { history, hasCatalogue, hasBriefedLaunch, skeleton } = params;
  const out: string[] = [];

  if (!hasBriefedLaunch) {
    out.push('No launches or restocks are on record for this month — the draft assumes a business-as-usual month.');
  }
  if (!hasCatalogue) {
    out.push('No product catalogue is cached, so no beat names a specific product or colourway.');
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

/** Build the structured evidence for one slot. Never prose, never invented. */
function evidenceFor(slot: AllocatedSlot, skeleton: Skeleton, pillarShare: number | undefined): BeatRationaleEvidence {
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
  staleTrawlWarning?: string | undefined;
}

/**
 * Assemble the draft. Pure given its params — the caller does the database reads, so this
 * is directly testable and its determinism is a property of the function, not of a mock.
 */
export function assembleDraft(params: AssembleDraftParams): DraftPlan {
  const {
    clientId, cycleId, channel, month, posts, pillars, candidates, temperature,
    hasCatalogue, hasBriefedLaunch, configPostsPerWeek, floorSlots, series, staleTrawlWarning,
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
  const assumptions = detectAssumptions({ history, hasCatalogue, hasBriefedLaunch, skeleton });
  const shareByPillar = new Map(weights.weights.map((w) => [w.name, w.share]));

  const beats: DraftBeat[] = skeleton.slots.map((slot, i) => {
    const alloc = allocation[i] ?? { index: i, slotType: 'proven' as const };
    const beatMeta: BeatMeta = {
      slotType: alloc.slotType,
      rationaleEvidence: evidenceFor(alloc, skeleton, shareByPillar.get(slot.pillar)),
      ...(alloc.candidate ? { sourceRef: alloc.candidate.id } : {}),
      ...(assumptions.length > 0 ? { assumptions } : {}),
    };
    // SUBJECT PRECEDENCE: a standing commitment, then the client's own words, then the pillar.
    // The series leads because it is a slot the client has already decided the shape of — and
    // because allocateSlots was given the claimed indices, the second branch cannot collide
    // with the first. The pillar is what is left when a beat has no subject of its own, which
    // is the honest description of it rather than a failure to find one.
    const title = slot.series
      ? recurringTitle(slot.series.name, slot.format)
      : alloc.candidate
        ? experimentTitle(alloc.candidate.content, slot.format)
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
