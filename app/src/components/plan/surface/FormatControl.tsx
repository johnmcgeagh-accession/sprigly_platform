'use client';

/**
 * FormatControl.tsx — a compact segmented control for the three formats. (round 6, P2)
 *
 * Round 2 took the format control off the sheet, which left `swapFormat` a shipped, tested,
 * vocab-checked mutation that no screen could call. Rounds 2–5 flagged that and ranked three
 * options without choosing one. The operator's phone check chose, and chose the opposite of the
 * removal — spec §4.1, including the conflicting line in the same review and why this one governs.
 *
 * ONE COMPONENT, TWO MOMENTS. The detail sheet uses it to change a format and the add sheet uses
 * it to pick one, because choosing a format when you create a post and changing it afterwards are
 * the same decision at two times. A second control would drift into a second vocabulary.
 *
 * THE WORDS ARE §7's WORDS. The operator's note says "image/carousel/reel"; the terminology table
 * says the client-facing words are "Single post", "Carousel", "Reel", and `FORMAT_WORD` already
 * carries them. `single` IS the image format — this uses the name the rest of the surface uses
 * rather than inventing a fourth one for one control.
 *
 * The icon is here as well as the word, because the icon is the only thing that identifies a
 * format everywhere else on the surface (G2) and a control that names formats differently from
 * the cards is a control that has to be learned twice.
 */
import React from 'react';
import type { PostFormat } from '@/lib/types';
import { FormatGlyph, FORMAT_WORD } from './icons';

/** The three a social beat may take. `email` is excluded exactly as the mutations exclude it. */
export const PLANNABLE_FORMATS: PostFormat[] = ['single', 'carousel', 'reel'];

export function FormatControl({
  value, onChange, disabled, label = 'Format', testid = 'format-control',
}: {
  value: string;
  onChange: (f: PostFormat) => void;
  disabled?: boolean | undefined;
  /** The group's accessible name. Named, because three icons and three words in a row are not
   *  self-evidently *one* question to a screen reader. */
  label?: string;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid} role="group" aria-label={label}
      className="flex gap-[3px] rounded-[14px] bg-line-soft p-[3px]"
    >
      {PLANNABLE_FORMATS.map((f) => {
        const on = f === value;
        return (
          <button
            key={f} type="button" data-testid={`format-${f}`} data-on={on ? 'true' : undefined}
            aria-pressed={on} disabled={disabled} onClick={() => { if (!on) onChange(f); }}
            className={[
              // 40px is the floor; the control sits in a sheet header where a thumb is aiming
              // deliberately rather than walking, so it does not take the 44px band.
              'flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[11px]',
              'text-[12.5px] transition-colors duration-100',
              // THE INK RULE: a fill carrying a word is accent-650 with white, 3.40:1.
              on ? 'bg-coral-650 font-bold text-white' : 'font-semibold text-muted active:bg-line/20',
              disabled ? 'opacity-40' : '',
            ].join(' ')}
          >
            <FormatGlyph format={f} className="h-4 w-4" />
            <span>{FORMAT_WORD[f]}</span>
          </button>
        );
      })}
    </div>
  );
}
