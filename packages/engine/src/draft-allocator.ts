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
 * Day one, this resolves to nothing: loadDurableInputs filters plan_inputs to
 * type IN ('idea','next_cycle'), and every live row is type='note' — so the candidate
 * list is empty for every client (Phase 0 report, I-5 §3). That is the EXPECTED path,
 * not a failure, and it is tested as such. An empty backlog must produce a clean
 * all-proven month, never an empty one.
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
}

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
 * Rank candidates: client-sourced first, then by engagement, then by id.
 *
 * The final id tiebreak is not decoration — without it two candidates with the same
 * origin and no engagement would order by array position, which is a database row order,
 * which would break the assembler's determinism contract.
 */
export function rankCandidates(candidates: ExperimentCandidate[]): ExperimentCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === 'client' ? -1 : 1;
    const ea = a.engagement ?? 0;
    const eb = b.engagement ?? 0;
    if (ea !== eb) return eb - ea;
    return a.id.localeCompare(b.id);
  });
}

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
): AllocatedSlot[] {
  const slots: AllocatedSlot[] = Array.from({ length: Math.max(0, slotCount) }, (_, index) => ({
    index, slotType: 'proven' as const,
  }));
  if (slots.length === 0) return slots;

  const temp = typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : 0;
  if (temp <= 0) return slots;                       // null / 0 / negative → all proven

  const ranked = rankCandidates(candidates);
  const wanted = Math.round(Math.min(Math.max(temp, 0), 1) * slots.length);
  // Unfilled experimental slots revert to proven, so never claim more than we can fill.
  const count  = Math.min(wanted, ranked.length, slots.length);
  if (count === 0) return slots;

  // Evenly spaced positions: for count=2 of 10 → indices 2 and 7, not 0 and 1.
  const step = slots.length / count;
  for (let i = 0; i < count; i++) {
    const at = Math.min(slots.length - 1, Math.floor(i * step + step / 2));
    const candidate = ranked[i]!;
    slots[at] = { index: at, slotType: 'experiment', candidate, rank: i + 1, of: ranked.length };
  }
  return slots;
}
