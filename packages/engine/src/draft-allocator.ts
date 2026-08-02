/**
 * draft-allocator.ts — the temperature dial.
 *
 * D4: temperature is ALLOCATION-ONLY this arc. It decides how many of the month's slots
 * are drawn from the ideas backlog ("experiment") rather than from what this client's own
 * history says works ("proven"). It is NOT a model sampling temperature — that name is
 * already load-bearing three ways in this codebase (hook.ts:102, script.ts:59,
 * refine.ts:89, and the weather package), which is exactly why this module never touches
 * a model.
 *
 * This module's header used to say the candidate list resolves to nothing for every client,
 * because every live plan_inputs row was type='note' (Phase 0 report, I-5 §3). That has not
 * been true for some time: ivy-t's September window returns TWENTY type='idea' rows — six
 * never used, fourteen already run (docs/reports/beat-grounding.md §2.5). The backlog was
 * not empty; the dial above it was pinned to null, so the ranked list was built and thrown
 * away on every assembly.
 *
 * An empty backlog must still produce a clean all-proven month, never an empty one — that
 * property is unchanged and still tested.
 *
 * Pure. No db, no model.
 */

export interface ExperimentCandidate {
  /** plan_inputs.id — becomes beat_meta.sourceRef so a beat traces to its idea. */
  id:      string;
  content: string;
  /** Where the idea came from. Client ideas outrank competitor observations: acting on
   *  what the client asked for beats acting on what a competitor did. */
  origin:  'client' | 'competitor';
  /** Optional prior engagement signal. Absent today — nothing measures ideas yet. */
  engagement?: number;
  /**
   * plan_inputs.lifecycle — MATURITY, not availability. Absent on a candidate assembled
   * from anything but the backlog, and treated as unranked when so.
   */
  lifecycle?: string;
  /** plan_inputs.created_at as 'YYYY-MM-DD' — when she gave us this idea. Absent when unknown. */
  givenAt?: string;
}

/**
 * How maturity ranks, lowest first. Only relative order matters.
 *
 * A never-used idea leads: proposing something she asked for and has not yet seen is the
 * whole point of the slot. 'proven' comes next — it ran AND it worked, so re-proposing it is
 * a revival rather than a repeat — then 'measured', then 'used'. Anything unrecognised sorts
 * with 'used' rather than jumping the queue.
 *
 * 'declined' and 'stale' are not ranked here because they are not ranked at all: they are
 * refused outright (see rankCandidates). Someone said no, or the moment passed; re-proposing
 * either is how a plan stops looking like it was read.
 */
const LIFECYCLE_RANK: Record<string, number> = {
  candidate: 0,
  proven:    1,
  measured:  2,
  used:      3,
};
const LIFECYCLE_UNRANKED = 3;

/** Maturities a beat must never be built from, whatever the temperature. */
export const REFUSED_LIFECYCLES: ReadonlySet<string> = new Set(['declined', 'stale']);

export interface AllocatedSlot {
  index:    number;
  slotType: 'proven' | 'experiment';
  /** Set only on an experiment slot that a candidate actually filled. */
  candidate?: ExperimentCandidate;
  /** Rank of that candidate among all candidates, for rationaleEvidence. */
  rank?:      number;
  of?:        number;
}

/**
 * Rank candidates: refuse the dead ones, then client-sourced first, then by maturity, then
 * by engagement, then by id.
 *
 * Maturity sits BELOW origin and above engagement. Origin leads because acting on what the
 * client asked for beats acting on what a competitor did, and that ordering predates this.
 * Maturity comes next because among things she asked for, the one she has not yet seen is
 * the one worth a slot — with fourteen already-run ideas and six fresh ones in ivy-t's live
 * backlog, an unranked list would fill the month with repeats.
 *
 * The final id tiebreak is not decoration — without it two candidates with the same
 * origin and no engagement would order by array position, which is a database row order,
 * which would break the assembler's determinism contract.
 */
export function rankCandidates(candidates: ExperimentCandidate[]): ExperimentCandidate[] {
  const maturity = (c: ExperimentCandidate): number =>
    c.lifecycle === undefined ? LIFECYCLE_UNRANKED : (LIFECYCLE_RANK[c.lifecycle] ?? LIFECYCLE_UNRANKED);

  return candidates
    .filter((c) => c.lifecycle === undefined || !REFUSED_LIFECYCLES.has(c.lifecycle))
    .sort((a, b) => {
      if (a.origin !== b.origin) return a.origin === 'client' ? -1 : 1;
      const ma = maturity(a), mb = maturity(b);
      if (ma !== mb) return ma - mb;
      const ea = a.engagement ?? 0;
      const eb = b.engagement ?? 0;
      if (ea !== eb) return eb - ea;
      return a.id.localeCompare(b.id);
    });
}

/**
 * The temperature used when no per-client dial has been set — which is every client.
 *
 * One beat in five. The figure is a CEILING, not a target: allocateSlots clamps it to the
 * number of usable candidates, so a client with two fresh ideas gets two experiment slots and
 * a client with none gets an entirely proven month, exactly as before. It only bites when the
 * backlog is deep, and there it is the fence — ivy-t's twenty in-window ideas would otherwise
 * be free to take two thirds of September, which is not a proposal built on what works with
 * some bets in it, it is a different plan.
 *
 * A fifth is where the month still reads as her own: at 30 slots it is six beats she asked
 * for and twenty-four the history chose, and the six are spread rather than clustered
 * (see the placement below). D4's per-client dial, when it lands, overrides this; it does not
 * replace the clamping around it.
 */
export const DRAFT_DEFAULT_TEMPERATURE = 0.2;

/**
 * Allocate `slotCount` slots between proven and experimental.
 *
 * experiments = round(temperature × slotCount), clamped to [0, slotCount] and then to
 * the number of candidates actually available. Any experimental slot without a candidate
 * REVERTS TO PROVEN — the month always comes out full. A temperature of 1 against an
 * empty backlog yields an entirely proven month, not an empty one.
 *
 * Experiments are placed at evenly-spaced indices rather than at the front, so a
 * high-temperature month does not open with a run of untested ideas.
 */
export function allocateSlots(
  slotCount:   number,
  temperature: number | null | undefined,
  candidates:  ExperimentCandidate[],
  /**
   * Slot indices that already have a subject — today, the ones a configured recurring series
   * claimed. Experiments are placed among what is LEFT rather than over the top: a beat cannot
   * be both "Sunday Style" and "the idea she sent us in June", and quietly making it one while
   * recording the other is exactly the kind of untraceable claim the evidence contract exists
   * to prevent. The experiment COUNT is still computed from the full slot count, so temperature
   * keeps meaning what it meant; only where they land changes.
   */
  reservedIndices: ReadonlySet<number> = new Set(),
): AllocatedSlot[] {
  const slots: AllocatedSlot[] = Array.from({ length: Math.max(0, slotCount) }, (_, index) => ({
    index, slotType: 'proven' as const,
  }));
  if (slots.length === 0) return slots;

  const temp = typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : 0;
  if (temp <= 0) return slots;                       // null / 0 / negative → all proven

  const ranked = rankCandidates(candidates);
  const wanted = Math.round(Math.min(Math.max(temp, 0), 1) * slots.length);
  const free   = slots.map((s) => s.index).filter((i) => !reservedIndices.has(i));
  // Unfilled experimental slots revert to proven, so never claim more than we can fill.
  const count  = Math.min(wanted, ranked.length, free.length);
  if (count === 0) return slots;

  // Evenly spaced positions among the free slots: for count=2 of 10 → indices 2 and 7.
  const step = free.length / count;
  for (let i = 0; i < count; i++) {
    const at = free[Math.min(free.length - 1, Math.floor(i * step + step / 2))]!;
    const candidate = ranked[i]!;
    slots[at] = { index: at, slotType: 'experiment', candidate, rank: i + 1, of: ranked.length };
  }
  return slots;
}
