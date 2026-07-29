'use client';

/**
 * MonthGrid.tsx — the month view. A PEER of the day view, and the view you stay in.
 *
 * Spec §1.5. It is not a modal: no ✕, no dismiss — you leave it the way you entered it, through
 * the nav pill.
 *
 * ── Round 6, P6 supersedes N3 ────────────────────────────────────────────────────────
 *
 * Tapping a day used to flip to Day view and carry the date with it. On the device that read as
 * the calendar throwing you out — a client scanning the month to see *where things are* lost the
 * month the moment they touched it, and getting back cost a tap on a nav control they had not
 * been thinking about.
 *
 * So the grid stays, and the tap selects. What the day holds appears BENEATH the grid as compact
 * rows, and a tap on a row opens that post's sheet. Nothing is fetched either way — the month's
 * posts are already loaded for the grid that was just drawn — and the selection is shared with
 * Day view, so switching to Day afterwards lands on the day you were reading. That is the useful
 * half of N3, kept without its cost.
 *
 * THE LEGEND IS GONE. A calendar that needs a printed key has an encoding problem, and round 2
 * shipped one. The two states that need distinguishing differ in SHAPE — a filled dot is a
 * post, a ring is a post still being written — so the distinction survives greyscale and a
 * glance, and the one-line summary underneath names the exception in words instead.
 */
import React from 'react';
import { DOW_INITIAL, monthGrid, fromIso, MONTHS_FULL } from './dates';
import type { DayMark } from './WeekStrip';

export function MonthGrid({
  month, selected, today, marksFor, onPick, footer, summary,
}: {
  month: string;
  selected: string;
  today: string;
  /** Every mark on a day, in order. Density, not a count: three posts draw three dots. */
  marksFor: (iso: string) => DayMark[];
  onPick: (iso: string) => void;
  /** One sentence under the grid — the count, and the exception if there is one. */
  footer: string;
  /** What the selected day holds (round 6, P6). Rendered under the footer; the move picker
   *  passes nothing, because a picker's job ends at the date. */
  summary?: React.ReactNode | undefined;
}) {
  const cells = monthGrid(month);

  return (
    <div data-testid="month-grid" className="flex-1 overflow-y-auto px-[22px] pb-[104px] pt-[18px] [scrollbar-width:none]">
      <div className="grid grid-cols-7 gap-0.5 pb-1.5" aria-hidden="true">
        {DOW_INITIAL.map((d, i) => (
          <span key={i} className="text-center text-[10.5px] font-semibold uppercase tracking-[.1em] text-muted">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map(({ iso, day, inMonth }) => {
          const marks = marksFor(iso);
          const isSelected = iso === selected;
          const d = fromIso(iso);
          return (
            <button
              key={iso} type="button" data-testid="grid-cell" data-date={iso}
              aria-current={isSelected ? 'true' : undefined}
              aria-label={`${day} ${MONTHS_FULL[d.getMonth()]}${marks.length ? `, ${marks.length} post${marks.length === 1 ? '' : 's'}` : ', nothing planned'}${iso === today ? ', today' : ''}`}
              onClick={() => onPick(iso)}
              // aspect-square keeps the cell above 44px at 390px (350px ÷ 7 = 50px) and above
              // the 40px floor down to 320px (304 ÷ 7 = 43px).
              className="flex aspect-square flex-col items-center justify-center gap-[5px] rounded-[14px]"
            >
              <span
                className={[
                  'flex items-center justify-center text-[15px] tabular-nums',
                  isSelected
                    // The same filled control as the strip's selected day: accent-650 + white.
                    ? 'h-7 w-7 rounded-full bg-coral-650 font-bold text-white'
                    : inMonth ? 'font-medium text-chrome' : 'font-medium text-muted',
                  !isSelected && iso === today ? 'h-7 w-7 rounded-full shadow-[inset_0_0_0_2px_rgb(var(--t-accent-600,232_112_95))]' : '',
                ].join(' ')}
              >
                {day}
              </span>
              <span aria-hidden="true" className="flex h-1.5 items-center gap-[3px]">
                {marks.map((m, i) => (
                  <i key={i} data-testid="grid-dot" data-mark={m}
                    className={[
                      'block h-[5px] w-[5px] rounded-full',
                      m === 'draft' ? 'bg-coral-600'
                        // In flight: a RING, so the state survives greyscale and a glance.
                        : m === 'onway' ? 'shadow-[inset_0_0_0_1.5px_rgb(var(--t-chrome,51_65_85))]'
                        : 'bg-chrome',
                    ].join(' ')}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <p data-testid="month-foot" className="px-1 pt-[18px] text-[13.5px] leading-normal text-muted">{footer}</p>
      {summary}
    </div>
  );
}
