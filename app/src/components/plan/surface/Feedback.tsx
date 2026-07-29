'use client';

/**
 * Feedback.tsx — ONE channel, at the TOP. (round 6, P10)
 *
 * Session A left two feedback systems running at once: this one at the top of the shell carrying
 * undo, and `primitives.tsx`'s `Toast` pinned to the bottom carrying every `flash()` — saves,
 * network errors, beat markers, the agent's replies. On the device that reads as two different
 * products talking: a confirmation appeared at the top, and the confirmation of the very next act
 * appeared at the bottom, over the nav pill. The phone check's ruling is that all action feedback
 * consolidates HERE, and the bottom toast goes.
 *
 * So this component takes both sources and renders one thing:
 *
 *   undo     a message with an Undo action, held for LIFETIME_MS or until the next mutation
 *   message  a plain statement from `flash()`, cleared by usePlanData's own timer
 *
 * **Undo outranks a message** when both are live. A message says something happened; undo says
 * something happened *and here is the way back*, which is strictly more useful and strictly more
 * urgent. Showing both would be the two-channel problem again, one inch apart.
 *
 * ── Two decisions, both against the obvious default ───────────────────────────────────
 *
 * TOP, NOT BOTTOM. Round 1 anchored undo to the bottom, which put it directly over the action row
 * it was undoing — you tap Move, and the thing offering to undo the move lands on the Move button.
 * Here it sits above everything, including a sheet.
 *
 * ONE SLOT, NOT A STACK. It holds the last mutation and is replaced by the next. A stack of undos
 * implies an undo history the plan does not have: `reschedule` can put a date back, and that is
 * genuinely all. Offering a second level would be offering something that does not exist.
 *
 * It also carries gap 11. A cross-month move works — `PATCH /api/posts/:id` gates on date, not on
 * month — but nothing told the client where the post went, so a 31 October post moved to
 * 3 November simply vanished from the month they were looking at. The message names the
 * destination, and names the MONTH when the move crossed one.
 */
import React, { useEffect } from 'react';
import { AgentSays } from './AgentVoice';

export interface UndoState {
  message: string;
  /** Absent → a statement, not an offer. Some things genuinely cannot be undone. */
  onUndo?: (() => void) | undefined;
}

/** How long an undo stays offered. Long enough to read the sentence and decide. */
const LIFETIME_MS = 7000;

export function Feedback({
  undo, onDismiss, message, agent, agentWorking,
}: {
  undo: UndoState | null;
  onDismiss: () => void;
  /** `data.toast` — everything `flash()` says. It owns its own 3s lifetime upstream, so this
   *  component never dismisses it and never re-times it. */
  message?: string | null | undefined;
  /**
   * The agent's own reply, in the agent's own register (round 8, fix 7).
   *
   * It used to arrive through `message` and land in the dark slab below — the same shape as
   * "Moved to Friday". That slab means *the app did something to your plan*; a reply is the
   * other party in a conversation answering, and giving one meaning two shapes taught the client
   * nothing about either. It renders as `AgentSays`, exactly as the voice sheet and the reshape
   * do, and it outranks a plain message for the same reason undo does: it is a reply to
   * something they just said.
   */
  agent?: string | null | undefined;
  /** The turn is still running. Shows the dots, with or without words yet. */
  agentWorking?: boolean | undefined;
}) {
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(onDismiss, LIFETIME_MS);
    return () => clearTimeout(t);
  }, [undo, onDismiss]);

  // The agent speaking outranks a statement, and undo outranks the agent: undo is time-limited
  // and destructive to lose, and a reply is not.
  if (!undo && (agent || agentWorking)) {
    return (
      <AgentSays
        testid="feedback-agent" working={!!agentWorking} label="Sprigly"
        className="absolute inset-x-4 top-[46px] z-[40] shadow-[0_14px_34px_rgb(30_41_59_/_0.18)]"
      >
        {agent || undefined}
      </AgentSays>
    );
  }

  const state: UndoState | null = undo ?? (message ? { message } : null);
  if (!state) return null;

  return (
    <div
      data-testid="feedback" role="status" aria-live="polite" aria-atomic="true"
      className="absolute inset-x-4 top-[46px] z-[40] flex items-center gap-3.5 rounded-[14px] bg-chrome-deep px-[15px] py-3 text-[13.5px] font-medium text-white shadow-[0_14px_34px_rgb(30_41_59_/_0.3)]"
    >
      <span className="min-w-0 flex-1">{state.message}</span>
      {state.onUndo && (
        <button
          type="button" data-testid="feedback-undo"
          onClick={() => { state.onUndo?.(); onDismiss(); }}
          // accent-500 on chrome-deep is 6.99:1 — the one place the vivid tier is allowed to
          // be loud, because the field under it is the darkest on the surface.
          className="-my-2 flex-none py-2 text-[13.5px] font-bold text-coral-500"
        >
          Undo
        </button>
      )}
    </div>
  );
}
