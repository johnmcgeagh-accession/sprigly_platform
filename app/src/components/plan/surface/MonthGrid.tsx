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
import { scrollTail, type SurfaceFrame } from './frame';
import type { DayMark } from './WeekStrip';

export function MonthGrid({
  month, selected, today, marksFor, changedFor, ringedFor, onPick, footer, summary, lockToMonth,
  frame = 'mobile',
}: {
  month: string;
  selected: string;
  today: string;
  /** Every mark on a day, in order. Density, not a count: three posts draw three dots. */
  marksFor: (iso: string) => DayMark[];
  /** RECENTLY CHANGED: an extra accent dot beside the day's marks (what-changed visibility). */
  changedFor?: ((iso: string) => boolean) | undefined;
  /**
   * D5 — a day an OPEN interpretation turn names, on the desktop shell.
   *
   * A RING ON THE CELL, not a dot beside the numeral, and the distinction is the point: the dots
   * say what a day HOLDS, and this says what a sentence WOULD DO to it. Two different facts have
   * to look different or the client reads a proposal as a post. Nothing is applied while it is
   * up, and it leaves when the turn does.
   */
  ringedFor?: ((iso: string) => boolean) | undefined;
  onPick: (iso: string) => void;
  /**
   * ROUND 4 (the jump): the padding cells are INERT — another month's day cannot be selected
   * from this month's grid.
   *
   * Opt-IN rather than always-on, because the two callers want opposite things. A plan VIEW
   * owns the surface's position, and a padding pick there is the jump: one tap on 1 September
   * in the August grid and the day panel reads September under an August title, over posts
   * from a cycle nobody fetched. The MOVE PICKER owns no position at all — it steps months
   * with its own arrows and a cross-month move is the point of it — so it leaves this off.
   */
  lockToMonth?: boolean | undefined;
  /** One sentence under the grid — the count, and the exception if there is one. */
  footer: string;
  /** What the selected day holds (round 6, P6). Rendered under the footer; the move picker
   *  passes nothing, because a picker's job ends at the date. */
  summary?: React.ReactNode | undefined;
  /** Which shell this is rendering inside — see frame.ts. The desktop shell has no floating
   *  nav to reserve room for. */
  frame?: SurfaceFrame;
}) {
  const cells = monthGrid(month);
  /**
   * ── THE GRID FILLS ITS COLUMN ON DESKTOP ──────────────────────────────────────────
   *
   * On a phone the cells are `aspect-square`, and that is load-bearing: 350 ÷ 7 = 50px keeps
   * them over the 44px touch target, and 304 ÷ 7 = 43px keeps them over the 40px floor at
   * 320px. Width drives height, and the grid is as tall as it needs to be.
   *
   * On a wide monitor that same rule leaves the month column two-fifths full: at 680px the
   * cells are 97px square, six rows is 580px, and the rest of an 800px column is canvas. The
   * operator's word for it was that the build "doesn't scale up", and this is most of what
   * they were looking at.
   *
   * So on desktop the ROWS share the height instead, with a floor so a short month cannot
   * make them ridiculous. Nothing about the mobile geometry moves.
   */
  const desktop = frame === 'desktop';

  return (
    // THE RESERVATION IS THE SPACER AT THE FOOT, not `scrollPad` — see `scrollTail` in
    // frame.ts. This is the one scroll region on the surface that is also a FLEX CONTAINER,
    // and WebKit will not let a scroll container's own end padding create the overflow that
    // would let you reach past it. On a 2-post day in a 6-row month that left the summary row
    // 19px under the floating pill with `scrollHeight === clientHeight`, so there was nothing
    // for `overflow-y:auto` to scroll.
    <div data-testid="month-grid" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[22px] pt-[18px] [scrollbar-width:none]">
      <div className="grid flex-none grid-cols-7 gap-0.5 pb-1.5" aria-hidden="true">
        {DOW_INITIAL.map((d, i) => (
          <span key={i} className="text-center text-[10.5px] font-semibold uppercase tracking-[.1em] text-muted">{d}</span>
        ))}
      </div>
      <div className={`grid grid-cols-7 gap-0.5 ${desktop ? 'min-h-0 flex-1 [grid-auto-rows:minmax(64px,1fr)]' : ''}`}>
        {cells.map(({ iso, day, inMonth }) => {
          const marks = marksFor(iso);
          const isSelected = iso === selected;
          const d = fromIso(iso);
          const inert = !!lockToMonth && !inMonth;
          const ringed = !inert && !!ringedFor?.(iso);
          return (
            <button
              key={iso} type="button" data-testid="grid-cell" data-date={iso}
              aria-current={isSelected ? 'true' : undefined}
              // Disabled, never hidden — the same grammar the week strip's month edge uses.
              // The ring is announced, not just drawn: a change awaiting consent is exactly the
              // kind of state that must not be carried by colour alone.
              aria-label={inert
                ? `${day} ${MONTHS_FULL[d.getMonth()]} — in ${MONTHS_FULL[d.getMonth()]}, use the month arrows to open it`
                : `${day} ${MONTHS_FULL[d.getMonth()]}${marks.length ? `, ${marks.length} post${marks.length === 1 ? '' : 's'}` : ', nothing planned'}${iso === today ? ', today' : ''}${ringed ? ', in the change you are being asked about' : ''}`}
              disabled={inert}
              onClick={() => { if (!inert) onPick(iso); }}
              // aspect-square keeps the cell above 44px at 390px (350px ÷ 7 = 50px) and above
              // the 40px floor down to 320px (304 ÷ 7 = 43px). Desktop takes its height from
              // the row instead — see the note at the top.
              {...(ringed ? { 'data-ringed': 'true' } : {})}
              className={`flex ${desktop ? '' : 'aspect-square'} flex-col items-center justify-center gap-[5px] rounded-[14px] ${
                // accent-600 is NON-TEXT identity, which is precisely what this is: a 2px inset
                // and its own tint, with no ink on top of it.
                ringed ? 'bg-coral-100 shadow-[inset_0_0_0_2px_rgb(var(--t-accent-600,232_112_95))]' : ''
              }`}
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
                {/* Recently changed: the accent dot beside the chrome marks — same 5px grammar,
                    a different fact, decaying upstream as the day is viewed. */}
                {changedFor?.(iso) && (
                  <i data-testid="grid-changed" className="block h-[5px] w-[5px] rounded-full bg-coral-600" />
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p data-testid="month-foot" className="flex-none px-1 pt-[18px] text-[13.5px] leading-normal text-muted">{footer}</p>
      {summary}
      <div data-testid="scroll-tail" aria-hidden="true" className={scrollTail(frame)} />
    </div>
  );
}
