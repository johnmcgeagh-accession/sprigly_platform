'use client';

import React from 'react';
import type { PlanBeat } from '@/lib/types';

/** A beat's short calendar label — the product it features, else its kebab-case type. */
export function beatLabel(beat: PlanBeat): string {
  return (beat.product || beat.type || 'beat').replace(/-/g, ' ');
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dm(iso: string): { d: number; mon: string } {
  const [, m, d] = iso.split('-');
  return { d: Number(d), mon: MON[Number(m) - 1] ?? '' };
}
/** "25–31 Aug" (same month) or "30 Aug–2 Sep" (crossing) — the human span of a range beat. */
export function rangeSuffix(startIso: string, endIso: string): string {
  const a = dm(startIso); const b = dm(endIso);
  return a.mon === b.mon ? `${a.d}–${b.d} ${a.mon}` : `${a.d} ${a.mon}–${b.d} ${b.mon}`;
}

/** The tap/toast text for a beat: its note (or type), plus the resolved span for a range beat. */
export function beatFlashText(beat: PlanBeat): string {
  const base = beat.note || beat.type || 'Beat';
  return beat.endDate ? `${base} (${rangeSuffix(beat.date, beat.endDate)})` : base;
}

/**
 * A dated brief beat rendered on the calendar — DELIBERATELY distinct from a post chip:
 * a dashed amber marker with a diamond glyph, NO format icon/tag, visually secondary. Tap
 * surfaces the beat's note + resolved span. Read-only: beats are not editable as posts.
 *
 * Range beats span multiple days. `day` is the ISO date of the cell this marker sits in:
 *  - desktop (default): the FIRST day of the span shows the full label + span suffix; the
 *    continuation days render as a slim amber band (glyph only) so the beat reads as one
 *    spanning window across the week.
 *  - mobile: every day in the span lists the label + span suffix (each day stands alone).
 */
export function BeatMarker({ beat, day, onClick, mobile = false }: {
  beat: PlanBeat; day: string; onClick?: () => void; mobile?: boolean;
}) {
  const isRange = beat.endDate != null;
  const suffix  = isRange ? rangeSuffix(beat.date, beat.endDate as string) : '';
  // Desktop continuation cell (a range day that is not the start): band-only, no label text.
  const bandOnly = isRange && !mobile && day !== beat.date;
  const titleSpan = isRange ? ` (${suffix})` : '';

  return (
    <button
      type="button"
      data-testid="beat-marker"
      data-beat-type={beat.type}
      data-beat-range={isRange ? `${beat.date}/${beat.endDate}` : undefined}
      data-beat-segment={isRange ? (bandOnly ? 'continuation' : 'start') : 'single'}
      onClick={onClick}
      title={`${beat.note || beat.type}${titleSpan}`}
      aria-label={`Beat: ${beatLabel(beat)}${isRange ? ` (${suffix})` : ''}${beat.note ? ` — ${beat.note}` : ''}`}
      className={`flex w-full items-center gap-1 rounded-[6px] border-[1.5px] border-beat-border bg-beat text-left font-bold leading-tight text-beat-ink shadow-[0_1px_2px_rgba(120,80,0,.22)] ${
        bandOnly ? 'px-1.5 py-px text-[9px]' : 'px-1.5 py-0.5 text-[11px]'
      }`}
    >
      <span aria-hidden className="flex-shrink-0 text-[9px]">◆</span>
      {!bandOnly && (
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {beatLabel(beat)}{isRange ? <span className="font-semibold text-beat-ink/85"> · {suffix}</span> : null}
        </span>
      )}
    </button>
  );
}
