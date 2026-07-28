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
  badge, headerRight, strip, topSlot, overlays, children,
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
  /** The week strip, on the day view. Month view passes null and renders its grid as children. */
  strip?: React.ReactNode | undefined;
  /** Above everything — the undo snackbar, which renders at the TOP so it never sits over the
   *  action row it is undoing. */
  topSlot?: React.ReactNode | undefined;
  /** Sheets and scrims. Rendered after the nav so they slide over it. */
  overlays?: React.ReactNode | undefined;
  children: React.ReactNode;
}) {
  return (
    <div data-testid="plan-shell" className="relative flex h-[100dvh] flex-col overflow-hidden bg-bg text-chrome">
      {topSlot}

      {/* 2. Header — wordmark LEFT. The account chip is gone (G5): nothing sat behind it, and
          it returns when there is a settings surface to open. */}
      <div className="flex flex-none items-center gap-[7px] px-5 pb-0.5 pt-2.5">
        <SprigMarkV2 className="h-[18px] w-[18px] text-coral-600" />
        <span className="font-logo text-[17px] font-extrabold tracking-[-.02em] text-chrome">Sprigly</span>
      </div>

      {/* 3. Title row. The ‹ › arrows are the ONLY lateral month mechanism (G6) — the month
          pills and the wheel picker are both retired. */}
      <div className="flex flex-none items-center gap-1.5 px-[18px] pt-3">
        <div className="flex items-center gap-1">
          <ArrowBtn dir="prev" onClick={onPrevMonth} />
          <span data-testid="month-title" className="whitespace-nowrap text-[20px] font-bold tracking-[-.03em] text-chrome">
            {monthLabel}
          </span>
          <ArrowBtn dir="next" onClick={onNextMonth} />
        </div>
        <span className="flex-1" />
        {headerRight}
      </div>

      {/* 4. Today row. */}
      <div className="flex min-h-[44px] flex-none items-center justify-between gap-3 px-5 pt-2.5">
        <span className="min-w-0">{badge}</span>
        <button
          type="button" data-testid="today-btn" onClick={onToday} disabled={!todayEnabled}
          // 40px, not the mockups' 34px — nothing interactive sits under the floor (X3).
          className="min-h-[40px] flex-none rounded-full border border-line/30 bg-surface px-3.5 text-[13px] font-semibold text-coral-800 shadow-card transition-colors duration-100 active:bg-coral-100 disabled:text-muted/50 disabled:shadow-none"
        >
          Today
        </button>
      </div>

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
