/**
 * pillar-weights.ts — resolve pillar shares for the deterministic draft assembler.
 *
 * derivePillars has always asked the model for a per-pillar `sharePct`; until Build A,
 * toConfigPillars discarded it (Phase 0 report, I-1 §1a), so no pillar weight existed
 * anywhere in the system. It is now persisted — but only for configs written SINCE that
 * change. Every pre-existing client_planning_config row has pillars without a sharePct.
 *
 * Those rows are NOT backfilled. A backfill would mean re-running derivePillars per
 * client: a billable, non-deterministic model call producing weights nobody ever
 * measured, written as though they had been. Resolving on read is the smaller change
 * and the honest one — and the caller learns WHICH basis it got, so a beat grounded on
 * equal shares can say so in its rationaleEvidence instead of implying observation.
 *
 * Pure. No db, no model.
 */
import type { Pillar } from './types.js';

export interface PillarWeight {
  name:  string;
  /** Normalised share of the month's slots, 0–1. Weights always sum to ~1. */
  share: number;
}

export interface PillarWeights {
  weights: PillarWeight[];
  /** 'derived' = real sharePct values off the stored config. 'equal' = no stored
   *  shares, so every pillar gets an equal slice. Surfaced into rationaleEvidence. */
  basis:   'derived' | 'equal';
}

/**
 * Resolve stored pillars to normalised weights.
 *
 * Uses stored sharePct only when at least one pillar has a positive one — a config
 * where every share is 0/absent carries no information and is treated as equal, not as
 * "all pillars weight zero". Pillars are sorted by name so the output is stable
 * regardless of the stored array order: the assembler's determinism contract means the
 * same config must always yield the same skeleton.
 */
export function resolvePillarWeights(pillars: Pillar[]): PillarWeights {
  const named = pillars
    .filter((p) => typeof p?.name === 'string' && p.name.trim().length > 0)
    .map((p) => ({ name: p.name.trim(), share: typeof p.sharePct === 'number' && p.sharePct > 0 ? p.sharePct : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (named.length === 0) return { weights: [], basis: 'equal' };

  const total = named.reduce((sum, p) => sum + p.share, 0);
  if (total <= 0) {
    const equal = 1 / named.length;
    return { weights: named.map((p) => ({ name: p.name, share: equal })), basis: 'equal' };
  }
  return { weights: named.map((p) => ({ name: p.name, share: p.share / total })), basis: 'derived' };
}

/**
 * Spread `slotCount` slots across weighted pillars deterministically.
 *
 * Largest-remainder (Hare quota): floor each pillar's exact quota, then hand the
 * leftover slots to the largest fractional remainders. Ties break by pillar name, so
 * the result is fully determined by (weights, slotCount) — never by float ordering or
 * iteration accident. Guarantees the returned names sum to exactly slotCount.
 */
export function spreadPillars(weights: PillarWeight[], slotCount: number): string[] {
  if (weights.length === 0 || slotCount <= 0) return [];

  const quotas = weights.map((w) => {
    const exact = w.share * slotCount;
    const base  = Math.floor(exact);
    return { name: w.name, base, remainder: exact - base };
  });

  const assigned  = quotas.reduce((sum, q) => sum + q.base, 0);
  const leftovers = [...quotas].sort((a, b) =>
    b.remainder - a.remainder || a.name.localeCompare(b.name),
  );
  for (let i = 0; i < slotCount - assigned; i++) {
    leftovers[i % leftovers.length]!.base += 1;
  }

  // Emit interleaved rather than grouped, so a month does not open with five
  // consecutive posts of the same pillar. Round-robin over the per-pillar counts,
  // in a fixed (name-sorted) order — still fully deterministic.
  const counts = new Map(quotas.map((q) => [q.name, q.base]));
  const order  = quotas.map((q) => q.name).sort((a, b) => a.localeCompare(b));
  const out: string[] = [];
  while (out.length < slotCount) {
    let placedThisPass = false;
    for (const name of order) {
      const left = counts.get(name) ?? 0;
      if (left <= 0) continue;
      out.push(name);
      counts.set(name, left - 1);
      placedThisPass = true;
      if (out.length === slotCount) break;
    }
    if (!placedThisPass) break;   // defensive: cannot happen while counts sum to slotCount
  }
  return out;
}
