'use client';

/**
 * MonthWorking.tsx — the wizard's working state, ON the month it is changing.
 *
 * ── The defect this replaces ─────────────────────────────────────────────────────────
 *
 * `intakeBusy` was joined to the `Feedback` bar (c1038f1), which was right about the FACT and
 * wrong about the MOUNT. That bar renders `AgentSays` — an accent-tinted block with the mark
 * and a left edge — and it is correct where it was designed: in the conversation, at a chat
 * column's measure, where a turn from the other party is what it is. Rendered into `topSlot`
 * it takes the whole plan width, so a brief being applied put a full-bleed accent slab over
 * the top of the month at 1280 and over the chip and grid head at 390. On a surface whose one
 * action — Generate — is a bordered pill, the loudest thing on the screen was the wait.
 *
 * The component was not wrong. An affordance sized for a chat column was mounted across a plan.
 *
 * ── What replaces it ─────────────────────────────────────────────────────────────────
 *
 * The month is the thing changing, so the indicator goes on the month: the region fades and a
 * small dot pill sits centred over it. The dots are `AgentDots` — the SAME register the dock
 * uses, and the reason this is not a new visual language for waiting. What changes between the
 * two mounts is the frame around them, which is the thing that was mismatched.
 *
 * Three properties it has to hold, and how:
 *
 *   NO REFLOW.    The overlay is `absolute` inside a wrapper that inherits the flex contract
 *                 of the node it wraps (`flex min-h-0 flex-1 flex-col` — what every panel and
 *                 the grid already are as flex children). Nothing enters or leaves the flow
 *                 when `working` turns over, so the grid cannot move under a client's finger.
 *                 The old bar reserved nothing either, but it COVERED the head of the month;
 *                 this covers nothing that is not already dimmed.
 *
 *   STILL READ.   `opacity-60`, not a blanking scrim. `chrome` at 60% over the canvas still
 *                 clears the body-text floor, so the client watches their own month wait
 *                 rather than a rectangle. Dimming the CONTENT rather than laying a tint over
 *                 it is what keeps the dot pill at full strength on top.
 *
 *   INERT.        The dimmed region is `inert` while the brief lands — the same mechanism the
 *                 closed sheets use (primitives.tsx). A day tapped mid-apply would select
 *                 against a month that is about to be replaced, and the selection would then
 *                 be re-anchored under the client by the beats arriving: a tap with a result
 *                 nobody could predict. The header (Today, Brief the month, Generate), the
 *                 month arrows and the nav pill are all OUTSIDE this wrapper and stay live, so
 *                 nothing a client can reach for is taken away — only the surface that is
 *                 being rewritten stops answering.
 */
import React, { useEffect, useRef } from 'react';
import { AgentDots } from './AgentVoice';

/**
 * ── TWO INTENSITIES, ONE TREATMENT (generation) ──────────────────────────────────────
 *
 * A brief lands in about twenty-five seconds and REPLACES the month, so dimming it and taking
 * it out of reach is the honest thing to do: a day tapped mid-apply selects against rows that
 * are about to be gone.
 *
 * Generation is a different wait wearing the same clothes. It runs for minutes, and it does not
 * replace the month — it fills captions into beats that are already there and already correct.
 * A client reading their October while it writes is doing something reasonable, and the grid is
 * already telling them which posts are on their way (CommittedSurface maps 'generating' →
 * 'onway'). Dimming that for five minutes and refusing taps would take a usable month away to
 * report progress on it.
 *
 * So `blocking` is the intensity, not a second component. The pill, the dots and the register
 * are identical; what changes is whether the region behind them is dimmed and inert. Defaulting
 * to `true` keeps every existing mount byte-identical.
 */
export function MonthWorking({ working, label, detail, blocking = true, children }: {
  /** A wizard brief is in flight against this month — `data.intakeBusy`. */
  working: boolean;
  /** The screen-reader name for the wait. The dots are decorative and cannot supply one. */
  label: string;
  /**
   * A visible line under the dots — "18 of 31 written".
   *
   * Only worth showing on a wait long enough for a client to wonder whether it is stuck, which
   * is why the wizard passes none. Absent renders exactly the pill that shipped.
   */
  detail?: string | undefined;
  /** Dim and disable the region beneath. See the note above. */
  blocking?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // `inert` takes the region out of the tab order and the a11y tree as well as out of reach of
  // a pointer — set on the node rather than as an attribute, which is this codebase's idiom for
  // it (primitives.tsx) and the one that does not depend on React's attribute allow-list.
  useEffect(() => {
    const el = ref.current as (HTMLElement & { inert: boolean }) | null;
    if (el) el.inert = working && blocking;
  }, [working, blocking]);

  return (
    <div data-testid="month-working" className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        {...(working ? { 'data-working': 'true' } : {})}
        className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 motion-reduce:transition-none ${working && blocking ? 'opacity-60' : ''}`}
      >
        {children}
      </div>
      {working && (
        /**
         * z-[10] is DELIBERATELY under the nav pill's z-[25]. The pill is navigation, not a
         * plan control, and a client who wants to leave the month while it is being written
         * must be able to. The overlay covers the region it dims and nothing else.
         */
        <div
          data-testid="month-working-veil"
          {...(blocking ? {} : { 'data-blocking': 'false' })}
          /* Non-blocking sits at the FOOT of the region and lets pointers through
             (`pointer-events-none` on the frame, restored on the pill itself is unnecessary —
             nothing on it is clickable). Centred over a month nobody may touch is right for the
             blocking case and wrong for a five-minute one, where it would sit on top of the
             week a client is trying to read. */
          className={`absolute inset-0 z-[10] flex justify-center ${
            blocking ? 'items-center' : 'pointer-events-none items-end pb-4'
          }`}
        >
          <span
            role="status" aria-live="polite"
            className="flex items-center gap-2.5 rounded-full border border-line/30 bg-surface px-4 py-3 shadow-card"
          >
            <AgentDots />
            {detail && <span data-testid="month-working-detail" className="text-[13px] font-semibold text-chrome">{detail}</span>}
            <span className="sr-only">{label}</span>
          </span>
        </div>
      )}
    </div>
  );
}
