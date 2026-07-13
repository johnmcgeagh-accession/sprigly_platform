'use client';

import React from 'react';
import type { PlanBeat } from '@/lib/types';

/** A beat's short calendar label — the product it features, else its kebab-case type. */
export function beatLabel(beat: PlanBeat): string {
  return (beat.product || beat.type || 'beat').replace(/-/g, ' ');
}

/**
 * A dated brief beat rendered on the calendar — DELIBERATELY distinct from a post chip:
 * a dashed amber marker with a diamond glyph, NO format icon/tag, visually secondary. Tap
 * surfaces the beat's note/type. Read-only: beats are not editable as posts.
 */
export function BeatMarker({ beat, onClick }: { beat: PlanBeat; onClick?: () => void }) {
  return (
    <button
      type="button"
      data-testid="beat-marker"
      data-beat-type={beat.type}
      onClick={onClick}
      title={beat.note || beat.type}
      aria-label={`Beat: ${beatLabel(beat)}${beat.note ? ` — ${beat.note}` : ''}`}
      className="flex w-full items-center gap-1 rounded-[6px] border border-dashed border-[#CBB79A] bg-[#FBF6EE] px-1.5 py-0.5 text-left text-[11px] font-semibold leading-tight text-[#8A6D3B]"
    >
      <span aria-hidden className="flex-shrink-0 text-[9px]">◆</span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{beatLabel(beat)}</span>
    </button>
  );
}
