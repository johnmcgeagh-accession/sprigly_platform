'use client';

/**
 * DesktopShell.tsx — the four regions, and the arithmetic that makes them fit.
 *
 * The contract is `docs/design/desktop-plan-surface.md`. This is its §2, built.
 *
 *   ┌─────────┬──────────────────────────────┬───────────────┬──────────────────┐
 *   │  RAIL   │  MONTH                       │  DAY / DETAIL │  CONVERSATION    │
 *   │  196    │  512                         │  320          │  344             │
 *   └─────────┴──────────────────────────────┴───────────────┴──────────────────┘
 *      196   24            512            20        320       24        344      = 1440
 *
 * ── Why the day column is 320 and not wider ──────────────────────────────────────────
 *
 * It is the phone's own content measure. 390 minus its 20px gutters is 350; 320 here with the
 * column's own 2px of edge gives a card the same ~290px of text. Every card, grounding line and
 * caption in the set was designed and reviewed against that measure, and the detail panel opens
 * INTO this column at this width — which is what makes "nothing reflows when a post opens" true
 * rather than aspirational.
 *
 * ── Why the month column is 512 and not more ─────────────────────────────────────────
 *
 * 512 gives seven 69px cells: enough for a day numeral and its density pips, and not enough for
 * a post chip. That is the right answer rather than a compromise — at 69px a chip holds about six
 * characters of title, and the incumbent desktop's 148px cells with chips existed because that
 * surface had no day column to send you to.
 *
 * ── The breakpoints (spec §2.5) ──────────────────────────────────────────────────────
 *
 *   < 1080px    the MOBILE shell, and `PlanRoot`'s existing fork is not moved. It is already
 *               tested, both e2e projects are pinned either side of it, and a tablet in portrait
 *               gets a reviewed design rather than a squeezed desktop nobody has looked at.
 *   1080–1279   the plan region STACKS: month above, day (or the detail panel) below, scrolling
 *               together. Rail collapses to icons; dock narrows 344 → 320.
 *   ≥ 1280      month and day side by side.
 *
 * THE DOCK DOES NOT COLLAPSE IN THE MIDDLE BAND, and that is the rule this breakpoint exists to
 * protect. The obvious saving — a rail tab that expands the conversation over the plan — puts the
 * sentence and its consequence back on separate screens, which is the phone's compromise and not
 * a narrower desktop's. What gives way instead is the side-by-side-ness, and that degrades well:
 * stacked, the grid gets MORE room per cell, not less.
 *
 * Everything below is Tailwind's own responsive prefixes against the project's `xl` (1280px)
 * breakpoint, so there is no resize listener and no measured width in React state — a layout
 * that re-renders on resize is a layout that flickers on an iPad rotating.
 */
import React from 'react';
import { ChevronL, ChevronR } from './icons';
import { Rail } from './Rail';
import type { RailView } from './Rail';

export function DesktopShell({
  clientName, subtitle, view, onView, tasksCount, tasksLate, ideasCount,
  monthLabel, onPrevMonth, onNextMonth, onToday, todayEnabled,
  badge, headerRight, topSlot, month, day, dock, region, overlays,
}: {
  clientName: string;
  /** The rail's one context line — the month's own count, in the surface's own words. */
  subtitle: string;
  view: RailView;
  onView: (v: RailView) => void;
  tasksCount: number;
  ideasCount: number;
  tasksLate: boolean;
  monthLabel: string;
  onPrevMonth?: (() => void) | undefined;
  onNextMonth?: (() => void) | undefined;
  onToday: () => void;
  todayEnabled: boolean;
  /** The Draft badge and its line. Left of the month title, because provisional is a fact
   *  about the month and on this form factor the month has a title row of its own. */
  badge?: React.ReactNode | undefined;
  /** The Generate pill, on a draft month. */
  headerRight?: React.ReactNode | undefined;
  /** The one feedback channel, above everything — same rule as the phone (round 6, P10). */
  topSlot?: React.ReactNode | undefined;
  /** The month column: the grid, its footer, and the summary panel on a draft month. */
  month: React.ReactNode;
  /** The day column: the day's posts, or the detail panel that drills into one of them. */
  day: React.ReactNode;
  /** The conversation. Persistent — it is a region of the shell, not something summoned.
   *  ABSENT on a read-only month: `data.ask` refuses there, and a composer that can only be
   *  turned away is worse than no composer, which is the same rule the mobile mic follows. */
  dock?: React.ReactNode | undefined;
  /**
   * A view that owns the WHOLE plan region rather than one of its columns — Tasks and Ideas.
   * When present it replaces both columns; `month` and `day` are ignored.
   *
   * Tasks used to render into the `day` slot, which meant a checklist laid out in a 420px
   * column with 680px of empty month beside it — a mobile-width list marooned in a wide
   * region, which is the shape W4 names. What a task row wants is not the day's measure; it
   * is the region's.
   */
  region?: React.ReactNode | undefined;
  /** Sheets that genuinely still are sheets on this form factor: move, add, approval. */
  overlays?: React.ReactNode | undefined;
}) {
  return (
    /**
     * ── THE SHELL FILLS THE WINDOW; THE COLUMNS KEEP THEIR CEILING ────────────────────
     *
     * W1 capped the whole shell at `max-w-shell` and centred it, which stopped the columns
     * growing forever — the right goal — but at 2560 it also put the rail's left border and the
     * dock's right border 400px inside the viewport, with canvas either side. The app read as a
     * bordered rectangle floating in a field rather than as an app (operator, 3 Aug).
     *
     * Both rules hold at once by moving the cap DOWN a level. The shell is `w-full` and its two
     * edge regions are flush with the viewport; the ceiling lives on the plan columns, which
     * centre in whatever space is left between rail and dock. So the columns still stop at
     * 680/420, the surplus is still balanced on both sides of them — W1's rule, unchanged in
     * substance — and it is now INSIDE the app instead of around it.
     */
    // `svh`, for the reason written out in full on `PlanShell` — and it applies here too rather
    // than only on the phone: the desktop frame is chosen at `min-width: 1024px` (`PlanRoot`),
    // which an iPad in landscape Safari meets. That browser collapses its chrome exactly as the
    // phone's does, so this line carried the same latent fault; on a real desktop browser there
    // is no collapsing chrome and `svh`, `dvh` and `vh` are the same number.
    <div data-testid="plan-desktop" className="relative flex h-[100svh] w-full overflow-hidden bg-bg text-chrome">
      <Rail
        clientName={clientName} subtitle={subtitle}
        view={view} onView={onView} tasksCount={tasksCount} tasksLate={tasksLate} ideasCount={ideasCount}
      />

      {/* `relative` is what scopes `topSlot` to this column. The feedback bar is absolutely
          positioned, and without a containing block here it resolved against `plan-desktop` —
          the whole window — so the phone's `inset-x-4` became a 2528px bar across the rail, the
          header and the dock. Overlays are deliberately NOT in here: a modal and its scrim
          suspend the whole app and must keep the window as their frame. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {topSlot}

        {/* The header rides the columns' measure, not the window's. Left flush it would sit a
            long way from the grid it names once the surplus grew. */}
        <div className="mx-auto flex w-full max-w-cols flex-none items-center gap-2 px-6 pb-3 pt-4">
          <div className="-ml-[11px] flex min-w-0 items-center">
            <ArrowBtn dir="prev" onClick={onPrevMonth} />
            {/* The month is the page's subject, so it is the h1 — the same ladder the phone
                keeps. The wordmark is a mark and lives in the rail; it outranks this in scale
                without outranking it in structure. */}
            <h1 data-testid="month-title" className="text-[20px] font-bold tracking-[-.025em] text-chrome">
              {monthLabel}
            </h1>
            <ArrowBtn dir="next" onClick={onNextMonth} />
          </div>
          {badge}
          <span className="flex-1" />
          <button
            type="button" data-testid="today-btn" onClick={onToday} disabled={!todayEnabled}
            className="min-h-[40px] flex-none rounded-full border border-line/30 bg-surface px-4 text-[13.5px] font-semibold text-coral-800 shadow-card transition-colors duration-100 active:bg-coral-100 disabled:text-muted/50 disabled:shadow-none"
          >
            Today
          </button>
          {headerRight}
        </div>

        {/*
          THE PLAN REGION. Below `xl` it is one scrolling column with the month above the day;
          at `xl` and up the two are side by side and scroll independently.

          `min-h-0` on the flex child is what lets the inner regions own their own scrolling
          rather than growing the page — without it a long month pushes the whole shell taller
          than the viewport and the dock's composer walks off the bottom.
        */}
        {/*
          SIDE BY SIDE FROM 1440, STACKED BELOW IT.

          The switch used to be at `xl` (1280), where the two columns did not actually fit:
          512 + 20 + 320 needs 852px of content box and 1280 gives 692, so the day column was
          clipped at every width from 1280 to 1439 and nobody had looked. 1440 is the width
          the layout was reviewed at and the first at which it fits, so that is where it
          starts.

          Above it the columns are PROPORTIONS (flex-month / flex-day), so they grow together
          to their ceilings instead of leaving the surplus in the gap.
        */}
        {region ? (
          <div data-testid="plan-region" className="mx-auto flex min-h-0 w-full max-w-cols flex-1 flex-col overflow-hidden px-6 pb-6">
            {region}
          </div>
        ) : (
          <div
            data-testid="plan-cols"
            className="mx-auto flex min-h-0 w-full max-w-cols flex-1 flex-col gap-4 overflow-y-auto px-6 pb-5 wide:flex-row wide:gap-5 wide:overflow-hidden wide:pb-6"
          >
            <div data-testid="month-col" className="flex min-h-0 w-full flex-none flex-col wide:w-auto wide:flex-month wide:overflow-y-auto">
              {month}
            </div>
            <div data-testid="day-col" className="flex min-h-0 w-full flex-none flex-col wide:w-auto wide:flex-day">
              {day}
            </div>
          </div>
        )}
      </div>

      {/* THE DOCK. A region with its own edge, present in every state that HAS a conversation
          — see the spec's E1. The plan region takes the width back when there is none. */}
      {dock && (
        <aside
          data-testid="conversation-dock"
          className="flex w-dock flex-none flex-col border-l border-line/30 bg-surface"
        >
          {dock}
        </aside>
      )}

      {overlays}
    </div>
  );
}

/** A month arrow. 40px — the X3 floor, the same control the phone shell carries. Disabled
 *  rather than hidden at a month edge: "October doesn't show" was a DESKTOP report, and a
 *  control that disappears reads as a rendering fault. */
function ArrowBtn({ dir, onClick }: { dir: 'prev' | 'next'; onClick?: (() => void) | undefined }) {
  return (
    <button
      type="button" data-testid={`${dir}-month`} aria-label={dir === 'prev' ? 'Previous month' : 'Next month'}
      disabled={!onClick} onClick={onClick}
      className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-chrome transition-colors duration-100 hover:bg-line-soft disabled:text-muted/40 disabled:hover:bg-transparent"
    >
      {dir === 'prev'
        ? <ChevronL className="h-[17px] w-[17px]" />
        : <ChevronR className="h-[17px] w-[17px]" />}
    </button>
  );
}
