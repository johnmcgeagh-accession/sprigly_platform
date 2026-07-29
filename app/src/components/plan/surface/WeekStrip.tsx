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
 *
 * ── The pager is visible now (round 6, P5) ───────────────────────────────────────────
 *
 * The swipe shipped and the phone check reported the strip "locked to one week", which is what a
 * gesture nobody can see amounts to. Chevrons flank the strip and page it by a week, and the
 * swipe is unchanged underneath them — a visible control and an invisible shortcut for the same
 * act, which is the right way round.
 *
 * **They stop at the month's edge.** A chevron is disabled when the week it would reach holds no
 * day of the viewed month, because past that edge the strip would render a week whose posts are
 * not loaded: seven empty days, which reads as data loss rather than as a different month. Longer
 * jumps are the ‹ › month arrows' job, and they refetch. Disabled, never hidden — a control that
 * disappears reads as a rendering fault.
 *
 * The width is measured, not assumed: two 36px chevrons and 6px gutters leave 43px per day at
 * 390px and 41px at 375px, both over the 40px floor. At 320px the cells compress to 36px wide
 * (60px tall) — recorded rather than hidden, and the swipe and arrow keys still reach every week.
 */
import React, { useRef } from 'react';
import { DOW_SHORT, weekOf, addDays, monthOf, fromIso, MONTHS_FULL } from './dates';
import { ChevronL, ChevronR } from './icons';

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

  /** Can the strip reach the week `n` weeks away without leaving the month entirely? */
  const canPage = (n: number) => weekOf(addDays(selected, n * 7)).some((iso) => monthOf(iso) === month);
  const page = (n: number) => onSelect(addDays(selected, n * 7));

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
      className="flex flex-none items-center gap-0.5 px-1.5 pb-2 pt-1 [touch-action:pan-y]"
    >
      <PageBtn dir="prev" onClick={canPage(-1) ? () => page(-1) : undefined} />
      <div className="grid flex-1 grid-cols-7 gap-0.5">
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
                // Outside the month used to be `muted/70` here and `muted/40` on the numeral —
                // 1.8:1, which the first e2e axe run caught (round 6). A padding day is a real,
                // tappable date, so it is READABLE and de-emphasised by weight and by the
                // numeral's `muted` against the month's `chrome`, not by dissolving it.
                isSelected ? 'text-chrome' : 'text-muted',
              ].join(' ')}
            >
              {DOW_SHORT[i]}
            </span>
            <span aria-hidden="true"
              className={[
                'flex h-[34px] w-[34px] items-center justify-center rounded-full text-[16.5px] tabular-nums',
                // THE INK RULE: the selected day is a filled control — accent-650 + white.
                isSelected ? 'bg-coral-650 font-bold text-white'
                  : outside ? 'font-medium text-muted' : 'font-medium text-chrome',
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
      <PageBtn dir="next" onClick={canPage(1) ? () => page(1) : undefined} />
    </div>
  );
}

/** One week back or forward. 36×60px, so it matches the day cells it sits beside rather than
 *  floating above them, and disabled at the month's edge (see the header note). */
function PageBtn({ dir, onClick }: { dir: 'prev' | 'next'; onClick?: (() => void) | undefined }) {
  const Glyph = dir === 'prev' ? ChevronL : ChevronR;
  return (
    <button
      type="button" data-testid={`${dir}-week`} aria-label={dir === 'prev' ? 'Previous week' : 'Next week'}
      disabled={!onClick} onClick={onClick}
      className="flex h-[60px] w-9 flex-none items-center justify-center rounded-2xl text-chrome transition-colors duration-100 active:bg-line-soft disabled:text-muted/30 disabled:active:bg-transparent"
    >
      <Glyph className="h-4 w-4" />
    </button>
  );
}

function labelOf(iso: string): string {
  const d = fromIso(iso);
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
}
