'use client';

/**
 * MoveSheet.tsx — a date AND a time, over the whole month, across months.
 *
 * Spec §4 / §5.5 gap 1. Three things it does that the old `CalendarPicker` move did not:
 *
 * THE WHOLE MONTH. Round 4 clipped the grid to roughly half a month, which made a picker look
 * like a fragment of one. It is the same `MonthGrid` the Month view uses.
 *
 * FREE MONTH NAVIGATION. The ‹ › arrows here walk CALENDAR months, not the client's cycles —
 * a post can be moved to a month no cycle plans, and the picker has to be able to reach it.
 * The write is unchanged: `PATCH /api/posts/:id` gates on the date, not on the month, and a
 * post keeps its own `cycleId`. What follows is documented rather than prevented: the post
 * still belongs to the month that planned it, `loadCrossMonthPosts` surfaces it BY DATE in the
 * destination, and if no cycle plans that month it lands in the "Outside this month" strip. The
 * one thing that was missing is a sentence saying where it went, and the snackbar now says it.
 *
 * A TIME. `PlanPost.postingTime` reads `source_meta.postingTime` and the patch writes the same
 * key, so the surface edits exactly what the planner wrote. The slots offered are the client's
 * OWN times, derived from the posts already on screen — not `client_planning_config.posting_times`,
 * which no reader surfaces, and not the `PostingTimes` contract's documented example values,
 * which is what every mockup time actually was. Deriving from real posts means the list is
 * never a fiction; when there are no times on record it falls back to a small stated set, and
 * the free field is always there.
 */
import React, { useMemo, useState } from 'react';
import { MonthGrid } from './MonthGrid';
import { Sheet } from './Sheet';
import { ChevronL, ChevronR, CloseGlyph } from './icons';
import { monthOf, monthTitle, addDays, daysInMonth, shortDate } from './dates';

/** Offered when the client has no times on record at all. Stated as a starting point in the
 *  copy rather than presented as theirs. */
const FALLBACK_SLOTS = ['07:00', '12:00', '18:00'];

export function MoveSheet({
  open, postDate, postTime, postHeading, knownTimes, canMoveTo, onClose, onMove, timeEditable = true,
}: {
  open: boolean;
  postDate: string;
  postTime: string | null;
  postHeading: string;
  /** Times already used across the client's posts — their real slots. */
  knownTimes: string[];
  /**
   * False on a DRAFT month. `POST /api/plan/draft {op:'move'}` writes a date and there is no
   * posting-time op on that route — the assembler stores none either. Offering an hour we
   * could not save is the same fault as the mockups' invented times, one layer down.
   */
  timeEditable?: boolean;
  /** The date gate, so a past date is unpickable rather than refused after the fact. */
  canMoveTo: (iso: string) => boolean;
  onClose: () => void;
  onMove: (date: string, time: string) => void;
}) {
  const [month, setMonth] = useState(() => monthOf(postDate));
  const [date, setDate] = useState(postDate);
  const [time, setTime] = useState(postTime ?? '');

  // Re-seed each time the sheet opens on a different post; a stale date from the last move
  // would be a silent wrong answer.
  const [seeded, setSeeded] = useState(postDate);
  if (open && seeded !== postDate) {
    setSeeded(postDate);
    setMonth(monthOf(postDate));
    setDate(postDate);
    setTime(postTime ?? '');
  }

  const slots = useMemo(() => {
    const own = [...new Set(knownTimes.filter(Boolean))].sort();
    const list = own.length ? own : FALLBACK_SLOTS;
    // Whatever is already set stays offered even if it is nobody else's slot.
    return [...new Set([...list, ...(postTime ? [postTime] : [])])].sort().slice(0, 5);
  }, [knownTimes, postTime]);

  if (!open) return null;

  const stepMonth = (n: number) => {
    const first = `${month}-01`;
    setMonth(monthOf(n > 0 ? addDays(first, daysInMonth(month)) : addDays(first, -1)));
  };
  const crossesMonth = monthOf(date) !== monthOf(postDate);

  return (
    // layer 1: Move opens FROM the detail sheet, which stays mounted underneath. The two are
    // ordered in z rather than sharing a layer, and each has its own focus trap — without one,
    // Tab walked straight back out into the sheet behind.
    <Sheet open={open} label={`Move ${postHeading}`} testid="move-sheet" onClose={onClose} layer={1} hasOwnClose>
      <>
        <div className="flex flex-none items-start gap-3 border-b border-line/30 px-[18px] pb-3.5 pt-1.5">
          <div className="min-w-0 flex-1">
            <h2 className="mb-1 text-[20px] font-bold tracking-[-.025em] text-chrome">Move to…</h2>
            <p className="truncate text-[13.5px] font-medium text-muted">{postHeading}</p>
          </div>
          <button type="button" data-testid="move-close" aria-label="Close" onClick={onClose}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-line-soft text-chrome">
            <CloseGlyph className="h-[17px] w-[17px]" />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto [scrollbar-width:none]">
          {/* Calendar months, not the client's cycles: the destination may be a month no cycle
              plans, and the picker has to be able to reach it. */}
          <div className="flex flex-none items-center gap-1 px-[18px] pt-3">
            <button type="button" data-testid="move-prev-month" aria-label="Previous month" onClick={() => stepMonth(-1)}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-chrome">
              <ChevronL className="h-[17px] w-[17px]" />
            </button>
            <span data-testid="move-month" className="text-[18px] font-bold tracking-[-.03em] text-chrome">{monthTitle(month)}</span>
            <button type="button" data-testid="move-next-month" aria-label="Next month" onClick={() => stepMonth(1)}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-chrome">
              <ChevronR className="h-[17px] w-[17px]" />
            </button>
          </div>

          <MonthGrid
            month={month} selected={date} today={postDate}
            marksFor={() => []}
            onPick={(iso) => { if (canMoveTo(iso)) setDate(iso); }}
            footer={crossesMonth
              ? `Moving to ${shortDate(date)} — that is outside ${monthTitle(monthOf(postDate)).split(' ')[0]}.`
              : `Moving to ${shortDate(date)}.`}
          />

          {timeEditable && (
          <div className="flex-none px-[18px] pb-4">
            <h3 className="mb-2 mt-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted">Posting time</h3>
            <div data-testid="time-slots" className="flex flex-wrap gap-1.5">
              {slots.map((s) => (
                <button
                  key={s} type="button" data-testid="time-slot" data-time={s}
                  aria-pressed={time === s} onClick={() => setTime(s)}
                  className={[
                    'min-h-[40px] rounded-full px-3.5 text-[13.5px] tabular-nums',
                    time === s ? 'bg-coral-650 font-bold text-white' : 'bg-line-soft font-semibold text-chrome',
                  ].join(' ')}
                >
                  {s}
                </button>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2.5 text-[13.5px] text-muted">
              <span className="flex-none">Another time</span>
              {/* A native time input, not a press-and-hold. The gesture the mockup drew is
                  undiscoverable and has no keyboard equivalent; the platform control has both. */}
              <input
                type="time" data-testid="time-free" value={time} onChange={(e) => setTime(e.target.value)}
                className="min-h-[40px] flex-1 rounded-[14px] border border-line/55 bg-surface px-3 text-[15px] tabular-nums text-chrome outline-none"
              />
            </label>
            <p className="mt-2 text-[12.5px] leading-normal text-muted">
              {knownTimes.length ? 'Your usual slots.' : 'A starting point — we don’t have your usual times on record yet.'}
            </p>
          </div>
          )}
        </div>

        <div className="flex flex-none gap-2 border-t border-line/30 bg-surface px-[18px] pb-[26px] pt-3">
          <button
            type="button" data-testid="move-confirm" onClick={() => onMove(date, time)}
            className="flex min-h-[50px] flex-1 items-center justify-center rounded-[14px] bg-coral-650 text-[15px] font-bold text-white shadow-[0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.58)]"
          >
            Move it
          </button>
        </div>
      </>
    </Sheet>
  );
}
