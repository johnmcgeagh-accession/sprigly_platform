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
  return beat.range ? `${base} (${rangeSuffix(beat.range.start, beat.range.end)})` : base;
}

/**
 * A dated brief beat rendered on the calendar — DELIBERATELY distinct from a post chip:
 * a soft tint-filled PILL (no border) led by a small solid accent dot, NO format icon/tag. In the one-accent
 * system beats and posts differ by FORM, not hue: a filled coral-100 pill (coral-700 border,
 * coral-800 ink, 6.35:1) vs a white post card. Tap surfaces the beat's note + resolved span.
 * Read-only: beats are not editable as posts.
 *
 * A range beat renders ONCE, on its placement day (the first day of its span visible in the
 * viewed month) — the same labelled pill as a single-day beat, with the full span appended
 * as a suffix ("warehouse sale · 25–31 Aug"). Continuation-day bands were removed after live
 * review, so desktop and mobile behave identically.
 */
export function BeatMarker({ beat, onClick }: { beat: PlanBeat; onClick?: () => void }) {
  const suffix = beat.range ? rangeSuffix(beat.range.start, beat.range.end) : '';
  const titleSpan = suffix ? ` (${suffix})` : '';

  return (
    <button
      type="button"
      data-testid="beat-marker"
      data-beat-type={beat.type}
      data-beat-range={beat.range ? `${beat.range.start}/${beat.range.end}` : undefined}
      data-beat-segment={beat.range ? 'range' : 'single'}
      onClick={onClick}
      title={`${beat.note || beat.type}${titleSpan}`}
      aria-label={`Beat: ${beatLabel(beat)}${suffix ? ` (${suffix})` : ''}${beat.note ? ` — ${beat.note}` : ''}`}
      className="flex w-full items-center gap-1.5 rounded-[6px] bg-coral-100 px-1.5 py-[3px] text-left text-[11px] font-bold leading-tight text-coral-800"
    >
      <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-coral-700" />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        {beatLabel(beat)}{suffix ? <span className="font-semibold text-coral-800/85"> · {suffix}</span> : null}
      </span>
    </button>
  );
}
