'use client';

/**
 * NavPill.tsx — the floating bottom nav: a segmented pill and a SEPARATE circular microphone.
 *
 * Spec §1.2 (N1) and DESIGN.md → Components. This supersedes BOTH earlier shapes: round 3's
 * bottom tab bar and round 3's header Week|Month switcher. One place to change view, one
 * place to talk. It floats clear of the bottom edge on a blurred material rather than welding
 * itself to a 56px band, which closes the viewport — most of what separates an app from a page
 * that ran out of content — without claiming the space.
 *
 * ── Two decisions worth not re-litigating ────────────────────────────────────────────
 *
 * ICON-ONLY UNSELECTED. The selected segment shows icon + label; the others are icon-only with
 * an `aria-label`. That is what lets three segments and a word fit a ~290px pill without
 * crowding. Round 3 recorded labels-on-everything as "the designated cheap reversal", and the
 * round-5.1 review flagged the Day glyph (a bare rounded rect) as the weakest of the three —
 * so if this needs reversing, it is one line, and this is where.
 *
 * SEGMENTS ARE `flex-1`. The Insights view joins at Stage II and must drop in as a fourth
 * segment with no layout change (spec gap 12). It is deliberately not drawn here: a control
 * that does nothing is worse than an absent one.
 *
 * The mic is a peer, not a segment. Views and speech are different kinds of act, and the mic
 * is the one that spends money.
 */
import React from 'react';
import { NavDayGlyph, NavMonthGlyph, NavTasksGlyph, ChatMarkGlyph } from './icons';

export type PlanView = 'day' | 'month' | 'tasks';

const SEGMENTS: { view: PlanView; label: string; Glyph: (p: { className?: string }) => React.ReactElement }[] = [
  { view: 'day',   label: 'Day',   Glyph: NavDayGlyph },
  { view: 'month', label: 'Month', Glyph: NavMonthGlyph },
  { view: 'tasks', label: 'Tasks', Glyph: NavTasksGlyph },
];

export function NavPill({
  view, onView, onMic, micLabel, tasksDot,
}: {
  view: PlanView;
  onView: (v: PlanView) => void;
  /** Absent → no microphone is rendered at all. On a read-only month `data.ask` refuses, and
   *  offering a mic that will refuse is worse than offering none (spec §1.2). */
  onMic?: (() => void) | undefined;
  micLabel: string;
  /** A quiet mark on Tasks when something is late. Shape as well as colour — it sits beside
   *  the glyph rather than recolouring it. */
  tasksDot?: boolean | undefined;
}) {
  return (
    <nav
      data-testid="nav-pill" aria-label="Views"
      // 22px above the bottom edge — plus the home indicator, where there is one. The shell
      // bleeds to the hardware on purpose (the canvas is painted through the safe areas so the
      // Safari bands and the overscroll match it), which means the ONE thing that must know
      // about the inset is the thing that would otherwise sit under the client's thumb. On a
      // phone with no indicator `env()` resolves to 0 and this is the 22px it always was.
      className="pointer-events-none absolute inset-x-4 bottom-[calc(22px+env(safe-area-inset-bottom,0px))] z-[25] flex items-center gap-2.5"
    >
      <div
        role="tablist" aria-label="Plan views"
        className={[
          'pointer-events-auto flex flex-1 gap-[3px] rounded-full p-[5px]',
          // The blurred material. `bg-surface/[.78]` keeps it a THEME colour at 78% rather
          // than a hard-coded white, so a dark theme would carry its own surface through.
          'bg-surface/[.78] backdrop-blur-[20px] backdrop-saturate-[1.8]',
          'shadow-[0_8px_28px_-6px_rgb(30_41_59_/_0.28)] ring-1 ring-inset ring-surface/60',
        ].join(' ')}
      >
        {SEGMENTS.map(({ view: v, label, Glyph }) => {
          const selected = v === view;
          return (
            <button
              key={v} type="button" role="tab" aria-selected={selected}
              data-testid={`nav-${v}`}
              // The label is visible when selected, so naming it again would double it up for
              // a screen reader. Unselected it is the only name the control has.
              aria-label={selected ? undefined : label}
              onClick={() => onView(v)}
              className={[
                'relative flex flex-1 items-center justify-center gap-1.5 rounded-full',
                // 44px: the thumb-while-walking floor (DESIGN.md), not the 40px minimum.
                'min-h-[44px] text-[13.5px] transition-colors duration-150',
                selected
                  // THE INK RULE: a fill carrying a word is accent-650 with white, 3.40:1.
                  ? 'bg-coral-650 font-bold text-white'
                  : 'font-semibold text-muted',
              ].join(' ')}
            >
              <Glyph className="h-5 w-5" />
              {selected && <span>{label}</span>}
              {v === 'tasks' && tasksDot && (
                <span
                  aria-hidden="true"
                  className={`absolute right-2 top-2 h-[6px] w-[6px] rounded-full ${selected ? 'bg-white' : 'bg-coral-600'}`}
                />
              )}
            </button>
          );
        })}
      </div>

      {onMic && (
        <button
          type="button" data-testid="nav-mic" aria-label={micLabel} title={micLabel}
          onClick={onMic}
          className={[
            'pointer-events-auto flex h-14 w-14 flex-none items-center justify-center rounded-full',
            'bg-coral-650 text-white',
            // The accent glow. A non-text use of accent-600 — nothing sits on top of it.
            'shadow-[0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.58)]',
          ].join(' ')}
        >
          {/* A CHAT affordance, not a microphone (C2): the sheet is a conversation you can
              also speak to, and a mic named only one of its two ways in. */}
          <ChatMarkGlyph className="h-[26px] w-[26px]" />
        </button>
      )}
    </nav>
  );
}
