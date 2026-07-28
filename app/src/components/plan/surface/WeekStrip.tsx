'use client';

/**
 * WeekStrip.tsx — seven days. The strip SELECTS; it does not scroll a feed.
 *
 * Spec §1.4, the round-2 reversal: round 1 kept PlanMobile's week feed and scroll-spy on the
 * argument that it already was the day-focused pattern, and the phone review disagreed. A feed
 * that scrolls through seven days is a list view with a strip on top, and the strip's selection
 * is then fighting the scroll position for authority — which is exactly what `spyLock`, the
 * 140ms and 700ms timers and the StrictMode mount guard in PlanMobile existed to referee. None
 * of that machinery is here, because there is nothing left for it to arbitrate.
 *
 * The cost of the reversal is that moving between weeks needs a gesture. This strip is a CSS
 * grid, so it carries a horizontal SWIPE (the month grid covers any jump longer than a week).
 * The swipe is a pointer gesture with a keyboard equivalent — arrow keys move the selection by
 * a day and roll into the next week — so no navigation is gesture-only.
 */
import React, { useRef } from 'react';
import { DOW_SHORT, weekOf, addDays, monthOf, fromIso, MONTHS_FULL } from './dates';

export type DayMark = 'none' | 'draft' | 'committed' | 'onway';

export function WeekStrip({
  selected, today, month, markFor, countFor, onSelect,
}: {
  selected: string;
  today: string;
  /** The month the surface is showing. Days outside it are muted but stay tappable. */
  month: string;
  markFor: (iso: string) => DayMark;
  countFor: (iso: string) => number;
  onSelect: (iso: string) => void;
}) {
  const week = weekOf(selected);
  const drag = useRef({ x: 0, active: false });

  /** Horizontal swipe → ±7 days, keeping the weekday you were on. 48px is past the point
   *  where a vertical scroll would have claimed the gesture. */
  const onPointerDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, active: true }; };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    drag.current.active = false;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) < 48) return;
    onSelect(addDays(selected, dx < 0 ? 7 : -7));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    onSelect(addDays(selected, e.key === 'ArrowRight' ? 1 : -1));
  };

  return (
    <div
      data-testid="week-strip" role="group" aria-label={`Week of ${labelOf(week[0]!)}`}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current.active = false; }}
      onKeyDown={onKeyDown}
      className="grid flex-none grid-cols-7 gap-0.5 px-3 pb-2.5 pt-2 [touch-action:pan-y]"
    >
      {week.map((iso, i) => {
        const d = fromIso(iso);
        const isSelected = iso === selected;
        const isToday = iso === today;
        const outside = monthOf(iso) !== month;
        const mark = markFor(iso);
        const count = countFor(iso);
        return (
          <button
            key={iso} type="button" data-testid="week-day" data-date={iso}
            aria-pressed={isSelected}
            aria-label={`${DOW_SHORT[i]} ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}, ${count === 0 ? 'nothing planned' : `${count} post${count === 1 ? '' : 's'}`}${isToday ? ', today' : ''}`}
            onClick={() => onSelect(iso)}
            // min-h 60px clears the 40px floor comfortably; the numeral inside is 34px.
            className="relative flex min-h-[60px] flex-col items-center gap-1.5 rounded-2xl pb-2 pt-1"
          >
            <span aria-hidden="true"
              className={[
                'text-[10.5px] font-semibold uppercase tracking-[.1em]',
                isSelected ? 'text-chrome' : outside ? 'text-muted/70' : 'text-muted',
              ].join(' ')}
            >
              {DOW_SHORT[i]}
            </span>
            <span aria-hidden="true"
              className={[
                'flex h-[34px] w-[34px] items-center justify-center rounded-full text-[16.5px] tabular-nums',
                // THE INK RULE: the selected day is a filled control — accent-650 + white.
                isSelected ? 'bg-coral-650 font-bold text-white'
                  : outside ? 'font-medium text-muted/70' : 'font-medium text-chrome',
                // Today unselected is an accent-600 ring: a non-text use, nothing sits on it.
                isToday && !isSelected ? 'shadow-[inset_0_0_0_2px_rgb(var(--t-accent-600,232_112_95))]' : '',
              ].join(' ')}
            >
              {d.getDate()}
            </span>
            {/* The pip sits BELOW the numeral, on canvas rather than on the fill — which is why
                it stays accent when selected. Round 4 turned it white and it simply vanished. */}
            {mark !== 'none' && (
              <span aria-hidden="true" data-testid="day-pip" data-mark={mark}
                className={[
                  'absolute bottom-0.5 h-[5px] w-[5px] rounded-full',
                  mark === 'onway' ? 'shadow-[inset_0_0_0_1.5px_rgb(var(--t-chrome,51_65_85))]'
                    : mark === 'draft' || isSelected ? 'bg-coral-600' : 'bg-chrome',
                ].join(' ')}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function labelOf(iso: string): string {
  const d = fromIso(iso);
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
}
