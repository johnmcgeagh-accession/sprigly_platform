'use client';

/**
 * PlanShell.tsx — the ONE skeleton, for both surfaces.
 *
 * ── The structural problem this exists to fix ────────────────────────────────────────
 *
 * `PlanRoot` returned `DraftPlan` *before* the desktop/mobile fork was reached, so the draft
 * surface had no responsive shell at all: two surfaces, two sets of chrome, and every shared
 * element (the month control, the strip, the day panel, the detail sheet) built twice or built
 * once and unavailable to the other. Spec §1.3 names reconciling those two shells as the single
 * largest piece of work the redesign implies.
 *
 * This is that shell. It is deliberately PRESENTATIONAL — it owns the frame and the view
 * switch, and nothing about what a month is. Both callers pass their own panel content:
 *
 *     SURFACE = draft | committed        (the server decides — surface-state.ts)
 *        └── VIEW = day | month | tasks  (the nav pill)
 *              └── the surface's content renders INSIDE the view
 *
 * States are content, views are zoom, the shell is one. That ordering is the whole design: it
 * is why adding Insights later is a fourth segment rather than a fourth screen, and why the
 * draft surface joining in Session B is a different `children`, not a different shell.
 *
 * ── The frame, top to bottom (DESIGN.md → Layout) ────────────────────────────────────
 *
 *   1. Header      — wordmark, left
 *   2. Title row   — ‹ Month Year ›, with `headerRight` (the Generate pill on a draft month)
 *   3. Today row   — `badge` on the left (the Draft badge), Today on the right
 *   4. Week strip (day view) or the month grid (month view) — passed as `strip`
 *   5. Content     — `children`
 *   6. Floating nav — over the content, cleared by the panel's own bottom padding
 *
 * Sheets slide OVER the nav: they are rendered by the caller into `overlays`, above it in z.
 */
import React from 'react';
import { SprigMarkV2, ChevronL, ChevronR } from './icons';
import { NavPill, type PlanView } from './NavPill';

export function PlanShell({
  monthLabel, onPrevMonth, onNextMonth,
  view, onView, onMic, micLabel, tasksDot,
  onToday, todayEnabled,
  badge, headerRight, chip, strip, topSlot, overlays, children,
}: {
  monthLabel: string;
  /** Absent → the arrow is disabled, not hidden. A month edge is a fact worth showing. */
  onPrevMonth?: (() => void) | undefined;
  onNextMonth?: (() => void) | undefined;
  view: PlanView;
  onView: (v: PlanView) => void;
  onMic?: (() => void) | undefined;
  micLabel: string;
  tasksDot?: boolean | undefined;
  onToday: () => void;
  todayEnabled: boolean;
  /** Left of the Today row. The Draft badge and its one line live here. */
  badge?: React.ReactNode | undefined;
  /** Right of the title row, in the space the round-3 Week|Month switcher vacated. */
  headerRight?: React.ReactNode | undefined;
  /** The what-changed chip, between the Today row and the strip (spec §3). Fixed height, and
   *  the only thing allowed to sit here — a receipt must never push the day off the fold. */
  chip?: React.ReactNode | undefined;
  /** The week strip, on the day view. Month view passes null and renders its grid as children. */
  strip?: React.ReactNode | undefined;
  /** Above everything — the ONE feedback channel, which renders at the TOP so it never sits
   *  over the action row it is reporting on (round 6, P10). There is no bottom channel. */
  topSlot?: React.ReactNode | undefined;
  /** Sheets and scrims. Rendered after the nav so they slide over it. */
  overlays?: React.ReactNode | undefined;
  children: React.ReactNode;
}) {
  return (
    <div data-testid="plan-shell" className="relative flex h-[100dvh] flex-col overflow-hidden bg-bg text-chrome">
      {topSlot}

      {/* 2. Header — wordmark LEFT. The account chip is gone (G5): nothing sat behind it, and
          it returns when there is a settings surface to open.

          ── Round 6, P4: the header was "distorted — needs tying up" ──────────────────
          Two faults, and they compounded. The vertical rhythm stacked four paddings before the
          first card (10 + 12 + 10 + 8), so the day's content started a third of the way down a
          phone. And every row used a different gutter — 20px, 18px, 20px, 12px — which on a
          390px screen is four left edges close enough to read as a misalignment rather than as
          a decision. Now: ONE 20px gutter for every row, and the arrow buttons carry a negative
          margin so their 40px hit areas overhang it while their GLYPHS land on the same line as
          the wordmark. Hit-area expansion is visually inert; misalignment is not. */}
      <div className="flex flex-none items-center gap-[7px] px-5 pt-1.5">
        <SprigMarkV2 className="h-[18px] w-[18px] text-coral-600" />
        <span className="font-logo text-[17px] font-extrabold tracking-[-.02em] text-chrome">Sprigly</span>
      </div>

      {/* 3. MONTH ROW — and Today now sits on it (round 7, fix 4).
          The ‹ › arrows are the ONLY lateral month mechanism (G6); the month pills and the wheel
          picker are both retired.

          ── What the compression removed ────────────────────────────────────────────
          Today used to have a row of its own, shared with the Draft badge. On a COMMITTED month
          that badge is empty, so the row was 44px of nothing between the month and the strip —
          the dead zone the operator's screenshot marked. Today is right-aligned here instead,
          which is where the eye already is after reading the month, and the row below now
          renders only when it has something in it. Measured at 390×844: the day panel starts at
          156px rather than 200px, and the first card at 232 rather than 276. */}
      <div className="flex min-h-[40px] flex-none items-center gap-1.5 px-5 pt-1">
        <div className="-ml-[11px] flex min-w-0 items-center">
          <ArrowBtn dir="prev" onClick={onPrevMonth} />
          {/* The month IS the page's subject, so it is the h1. That gives the surface a clean
              ladder — h1 month, h2 day, h3 section, h4 card — where the old one started at h4
              and had no top level at all. The wordmark is a mark, not a heading. */}
          <h1 data-testid="month-title" className="whitespace-nowrap text-[20px] font-bold tracking-[-.03em] text-chrome">
            {monthLabel}
          </h1>
          <ArrowBtn dir="next" onClick={onNextMonth} />
        </div>
        <span className="flex-1" />
        <button
          type="button" data-testid="today-btn" onClick={onToday} disabled={!todayEnabled}
          // 40px, not the mockups' 34px — nothing interactive sits under the floor (X3).
          className="min-h-[40px] flex-none rounded-full border border-line/30 bg-surface px-3.5 text-[13px] font-semibold text-coral-800 shadow-card transition-colors duration-100 active:bg-coral-100 disabled:text-muted/50 disabled:shadow-none"
        >
          Today
        </button>
      </div>

      {/* 4. The state row: the Draft badge and its one line, with the Generate pill opposite.
          IT RENDERS ONLY WHEN IT HAS SOMETHING IN IT — a committed month has neither, and an
          empty row is the thing this fix removed. The Generate pill moved down from the month
          row so that row is never three controls wide at 390px. */}
      {(badge || headerRight) && (
        <div className="flex min-h-[40px] flex-none items-center justify-between gap-3 px-5 pt-1">
          <span className="min-w-0">{badge}</span>
          {headerRight}
        </div>
      )}

      {chip && <div className="flex-none pt-1.5">{chip}</div>}

      {strip}
      {strip && <div className="mx-5 h-px flex-none bg-line/30" aria-hidden="true" />}

      {children}

      <NavPill view={view} onView={onView} onMic={onMic} micLabel={micLabel} tasksDot={tasksDot} />
      {overlays}
    </div>
  );
}

/**
 * A month arrow. 40px, which is the X3 floor — the mockups measured these at 32px, and the
 * numbers were not to be inherited silently. Disabled rather than hidden at a month edge: a
 * control that disappears reads as a rendering fault, and "October doesn't show" was the
 * desktop report this control class exists to close.
 */
function ArrowBtn({ dir, onClick }: { dir: 'prev' | 'next'; onClick?: (() => void) | undefined }) {
  const Glyph = dir === 'prev' ? ChevronL : ChevronR;
  return (
    <button
      type="button" data-testid={`${dir}-month`} aria-label={dir === 'prev' ? 'Previous month' : 'Next month'}
      disabled={!onClick} onClick={onClick}
      className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-chrome disabled:text-muted/40"
    >
      <Glyph className="h-[17px] w-[17px]" />
    </button>
  );
}

export type { PlanView };
