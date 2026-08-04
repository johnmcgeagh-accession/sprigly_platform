'use client';

/**
 * Rail.tsx — the mobile nav pill, unrolled.
 *
 * ── What it navigates, and why the list is two long ──────────────────────────────────
 *
 * The phone's pill carries `Day · Month · Tasks`. On desktop the month grid and the selected
 * day are on screen TOGETHER (the spec's E2), so Day and Month stop being destinations the
 * moment they stop being alternatives. What is left is Plan, Tasks and — since W6 — Ideas.
 *
 * IDEAS WAS THE PREDICTED THIRD ITEM, and it arrived the way the note below said it would: a
 * vertical list took it with no layout change at all. It is a destination and not a panel on the
 * plan because it is a record of a RELATIONSHIP rather than of a month — the sentences in it
 * outlive the cycle on screen, and hanging them off one month would say the opposite.
 *
 * INSIGHTS IS STILL NOT DRAWN. The phone's ruling holds on both form factors: a control that
 * does nothing is worse than an absent one.
 *
 * ── The identity is the phone's component, not a copy of its styling ─────────────────
 *
 * `Wordmark` is imported from `PlanShell`, so the mark stays `accent-600` (a fill, the
 * identity's own tone), the word stays `accent-700` (`accent-600` is 2.35:1 on canvas and is
 * ruled out for text by name), the face stays `font-logo`, and the triple-tap that arms the
 * navigation trace comes with it. Re-styling it here is how the two surfaces drift — which is
 * exactly what happened once already, when the desktop MOCKUPS took `chrome` from the phone's
 * stale mockups rather than its built surface.
 *
 * ── Below xl ─────────────────────────────────────────────────────────────────────────
 *
 * The rail collapses to icons: the wordmark's text hides (the mark carries the identity alone),
 * the context block and the foot line go, and the late count becomes a dot. That is the
 * incumbent desktop rail's own collapsed behaviour, carried forward rather than reinvented.
 */
import React from 'react';
import { Wordmark } from './PlanShell';
import { NavMonthGlyph, NavTasksGlyph, NavIdeasGlyph } from './icons';

export type RailView = 'plan' | 'tasks' | 'ideas';

export function Rail({
  clientName, subtitle, view, onView, tasksCount, tasksLate, ideasCount,
}: {
  clientName: string;
  subtitle: string;
  view: RailView;
  onView: (v: RailView) => void;
  tasksCount: number;
  /** Something is late. Carried as a colour AND a word ("late") at full width, and as a dot
   *  when the rail is collapsed — never by hue alone. */
  tasksLate: boolean;
  /** How many durable inputs this client has given us, ever. Not a to-do — it is a record, and
   *  the count is here because "is any of what I said in there?" is answerable at a glance. */
  ideasCount: number;
}) {
  return (
    <nav
      data-testid="plan-rail"
      aria-label="Views"
      className="flex w-rail-tight flex-none flex-col items-center border-r border-line/30 bg-surface px-2.5 py-4 xl:w-rail xl:items-stretch xl:px-3.5"
    >
      {/* COLLAPSED, THE NAME STACKS UNDER THE MARK RATHER THAN GOING. 68px will not hold
          "Sprigly" beside the leaf at 22px, so the word used to be clipped or spilling over the
          month grid — and an app that drops its own name when the navigation narrows has decided
          the name was decoration. Stacked and small it fits with room to spare, and the mark
          keeps its size, so the identity reads the same at both widths. */}
      <Wordmark
        className="mb-4 flex flex-none flex-col items-center gap-1 xl:flex-row xl:justify-start xl:gap-[7px] xl:px-1.5"
        wordClassName="text-[12px] xl:text-[22px]"
      />

      <div className="hidden min-w-0 border-b border-line/30 px-1.5 pb-4 xl:block">
        <div data-testid="rail-client" className="truncate text-[15px] font-semibold tracking-[-.01em] text-chrome">{clientName}</div>
        <div className="mt-1 text-[12.5px] font-semibold text-muted">{subtitle}</div>
      </div>

      <div className="mt-3.5 flex w-full flex-col gap-1">
        <RailBtn view="plan" label="Plan" current={view} onView={onView} Glyph={NavMonthGlyph} />
        <RailBtn
          view="tasks" label="Tasks" current={view} onView={onView} Glyph={NavTasksGlyph}
          count={tasksCount} late={tasksLate}
        />
        <RailBtn
          view="ideas" label="Ideas" current={view} onView={onView} Glyph={NavIdeasGlyph}
          count={ideasCount}
        />
      </div>

      <div className="mt-auto hidden border-t border-line/30 px-1.5 pt-3.5 text-[12.5px] font-medium leading-normal text-muted xl:block">
        Opened from your link, no password needed.
      </div>
    </nav>
  );
}

function RailBtn({
  view, label, current, onView, Glyph, count, late,
}: {
  view: RailView;
  label: string;
  current: RailView;
  onView: (v: RailView) => void;
  Glyph: (p: { className?: string }) => React.ReactElement;
  count?: number | undefined;
  late?: boolean | undefined;
}) {
  const on = current === view;
  return (
    <button
      type="button" data-testid={`rail-${view}`} aria-current={on ? 'page' : undefined}
      onClick={() => onView(view)}
      // THE INK RULE: a fill carrying a word is `accent-650` with white — the same recorded
      // 3.40:1 deviation DESIGN.md scopes by name, and this control is the ninth entry on that
      // list (spec §3.1, D1). The label and the count ride the same fill.
      className={[
        'relative flex min-h-[44px] w-full items-center gap-[11px] rounded-[14px] px-3 text-left text-[15px] tracking-[-.01em] transition-colors duration-100',
        'justify-center xl:justify-start',
        // 700 when selected, and the weight is NOT competing with a base `font-semibold` in
        // the same class list — the recorded white-on-650 deviation is justified on the label
        // being short AND bold, and axe read it at 3.93 with a normal weight winning.
        on ? 'bg-coral-650 font-bold text-white' : 'font-semibold text-chrome hover:bg-line-soft',
      ].join(' ')}
    >
      <Glyph className={`h-5 w-5 flex-none ${on ? 'text-white' : 'text-muted'}`} />
      <span className="hidden flex-1 xl:block">{label}</span>
      {/* The label is hidden below xl, so the button needs a name of its own there. */}
      <span className="sr-only xl:hidden">{label}</span>
      {count !== undefined && count > 0 && (
        <>
          <span
            data-testid={`rail-${view}-count`}
            className={[
              'hidden flex-none text-[12.5px] font-bold tabular-nums xl:block',
              on ? 'text-white' : late ? 'text-danger' : 'text-muted',
            ].join(' ')}
          >
            {late ? `${count} late` : count}
          </span>
          {/* Collapsed: the number becomes a dot. Non-text, so the tier rules that govern
              small coloured text do not apply to it — and the count itself is one click away
              in the view it names. */}
          <span
            aria-hidden="true"
            className={[
              'absolute right-1.5 top-1.5 block h-[7px] w-[7px] rounded-full xl:hidden',
              late ? 'bg-danger' : 'bg-coral-600',
            ].join(' ')}
          />
        </>
      )}
    </button>
  );
}
