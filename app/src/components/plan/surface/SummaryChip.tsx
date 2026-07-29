'use client';

/**
 * SummaryChip.tsx — what changed, in 48px that never becomes 49. (spec §3)
 *
 * IT NEVER GROWS. A one-line change and a fourteen-item brief cost the same vertical space.
 * Round 1's panel put the whole diff above the day, which on a paste like Sally's — 700 words,
 * fourteen instructions — pushed the day off the screen entirely, so the client's first sight of
 * the month they asked us to reshape was a list of what we had done to it. The counts truncate
 * rather than wrap; the chevron says there is more, and the panel is where more lives.
 *
 * IT IS ONE CONTROL. Round 3 put an expand button and a ✕ on a 48px bar; round 4 made the whole
 * chip the button. Tap anywhere to toggle, and the chevron is a STATE INDICATOR rather than a
 * second target — the ✕ was the one a client would hit by accident, on the one element whose job
 * is to tell them what just happened to their month.
 *
 * CLEARING LIVES IN TWO PLACES, NEITHER OF THEM A ✕: a quiet text action at the foot of the
 * expanded panel, and the chip clearing itself on the next visit.
 *
 * THE HIGHLIGHTS ARE INDEPENDENT. Clearing the chip never un-marks what changed — "New" is
 * driven by `changedIds`, which is a different piece of state with a different lifetime.
 */
import React from 'react';
import { ChevronR, ChevronD } from './icons';

export function SummaryChip({
  label, expanded, onToggle,
}: {
  /** Already derived from the receipt's own lines — see receipt-summary.ts. Empty renders
   *  nothing at all, because a chip reading "0 changes" spends 48px to say nothing. */
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!label) return null;
  return (
    <button
      type="button" data-testid="summary-chip" aria-expanded={expanded}
      aria-label={`What changed: ${label}`} onClick={onToggle}
      className="mx-5 flex h-12 flex-none items-center gap-2.5 rounded-[14px] bg-coral-650 px-3.5 text-left text-white"
    >
      {/* THE COUNTS, and no heading. The chip has never had one: "what changed" as a label above
          "3 added · 3 replaced" says the same thing twice on the one bar that cannot afford it. */}
      <span data-testid="summary-counts" className="min-w-0 flex-1 truncate text-[13.5px] font-bold tabular-nums">{label}</span>
      {expanded ? <ChevronD className="h-[17px] w-[17px] flex-none" /> : <ChevronR className="h-[17px] w-[17px] flex-none" />}
    </button>
  );
}
