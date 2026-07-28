'use client';

/**
 * Snackbar.tsx — one slot, at the TOP.
 *
 * Spec §4 and §1.2. Two decisions, both against the obvious default:
 *
 * TOP, NOT BOTTOM. Round 1 anchored it to the bottom, which put it directly over the action
 * row it was undoing — you tap Move, and the thing offering to undo the move lands on the Move
 * button. Here it sits above everything, including a sheet.
 *
 * ONE SLOT, NOT A STACK. It holds the last mutation and is replaced by the next. A stack of
 * undos implies an undo history the plan does not have: `reschedule` can put a date back, and
 * that is genuinely all. Offering a second level would be offering something that does not
 * exist.
 *
 * It also carries gap 11. A cross-month move works — `PATCH /api/posts/:id` gates on date, not
 * on month — but nothing told the client where the post went, so a 31 October post moved to
 * 3 November simply vanished from the month they were looking at. The message names the
 * destination, and names the MONTH when the move crossed one.
 */
import React, { useEffect } from 'react';

export interface UndoState {
  message: string;
  /** Absent → a statement, not an offer. Some things genuinely cannot be undone. */
  onUndo?: (() => void) | undefined;
}

/** How long an undo stays offered. Long enough to read the sentence and decide. */
const LIFETIME_MS = 7000;

export function Snackbar({ state, onDismiss }: { state: UndoState | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(onDismiss, LIFETIME_MS);
    return () => clearTimeout(t);
  }, [state, onDismiss]);

  if (!state) return null;
  return (
    <div
      data-testid="snackbar" role="status" aria-live="polite" aria-atomic="true"
      className="absolute inset-x-4 top-[46px] z-[40] flex items-center gap-3.5 rounded-[14px] bg-chrome-deep px-[15px] py-3 text-[13.5px] font-medium text-white shadow-[0_14px_34px_rgb(30_41_59_/_0.3)]"
    >
      <span className="min-w-0 flex-1">{state.message}</span>
      {state.onUndo && (
        <button
          type="button" data-testid="snackbar-undo"
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
