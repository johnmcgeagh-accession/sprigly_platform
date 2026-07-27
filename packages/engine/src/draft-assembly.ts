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
  return out;
}

/** Build the structured evidence for one slot. Never prose, never invented. */
function evidenceFor(slot: AllocatedSlot, skeleton: Skeleton, pillarShare: number | undefined): BeatRationaleEvidence {
  if (skeleton.basis === 'template') {
    return {
      basis: 'template',
      ...(skeleton.reason ? { reason: skeleton.reason } : {}),
      cadenceBasis: skeleton.cadenceBasis,
    };
  }
  const format = skeleton.slots[slot.index]?.format;
  const observed = skeleton.formats.find((f) => f.format === format);
  return {
    basis: 'observed',
    ...(observed
      ? { formatEngagement: { format: observed.format, avgEngagement: observed.avgEngagement, posts: observed.posts } }
      : {}),
    ...(pillarShare !== undefined ? { pillarShare } : {}),
    cadenceBasis: skeleton.cadenceBasis,
    ...(slot.slotType === 'experiment' && slot.candidate && slot.rank && slot.of
      ? { candidateRank: { rank: slot.rank, of: slot.of, origin: slot.candidate.origin } }
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
  candidates: ExperimentCandidate[];// from loadDurableInputs — [] today, by design
  temperature: number | null;
  hasCatalogue: boolean;
  hasBriefedLaunch: boolean;
  configPostsPerWeek?: number | null;
  /** A client-stated cadence floor (kind:'cadence'), as a month slot count. Raises the slot
   *  count when the client asked for more than history would produce; never lowers it. */
  floorSlots?: number | null;
  staleTrawlWarning?: string | undefined;
}

/**
 * Assemble the draft. Pure given its params — the caller does the database reads, so this
 * is directly testable and its determinism is a property of the function, not of a mock.
 */
export function assembleDraft(params: AssembleDraftParams): DraftPlan {
  const {
    clientId, cycleId, channel, month, posts, pillars, candidates, temperature,
    hasCatalogue, hasBriefedLaunch, configPostsPerWeek, floorSlots, staleTrawlWarning,
  } = params;

  const history = observeHistory(posts);
  const weights = resolvePillarWeights(pillars);
  const skeleton = buildSkeleton({
    month, history, pillars: weights,
    ...(configPostsPerWeek !== undefined ? { configPostsPerWeek } : {}),
    ...(floorSlots !== undefined ? { floorSlots } : {}),
  });

  const allocation = allocateSlots(skeleton.slots.length, temperature, candidates);
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
    return {
      scheduledDate: slot.date,
      format:        slot.format,
      pillar:        slot.pillar,
      position:      i,
      title:         alloc.candidate
        ? experimentTitle(alloc.candidate.content, slot.format)
        : deterministicTitle(slot.pillar, slot.format),
      beatMeta,
    };
  });

  return {
    clientId, cycleId, channel, month, beats,
    basis: skeleton.basis,
    assumptions,
    ...(staleTrawlWarning ? { staleTrawlWarning } : {}),
  };
}
