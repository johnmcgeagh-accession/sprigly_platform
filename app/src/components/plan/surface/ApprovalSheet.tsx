'use client';

/**
 * ApprovalSheet.tsx — the one door that spends money, and it is labelled. (mockup 09)
 *
 * Round 2 made this an unlabelled tick FAB, which put the highest-stakes action in the product
 * behind a glyph a non-technical founder has no reason to read as "approve the month and start
 * spending". It is a labelled pill in the header now, and the mic — the action a client takes ten
 * times to approval's one — is the FAB.
 *
 * IT IS STILL TWO TAPS. The pill opens the consequence; the consequence has its own commit. That
 * is a product constraint, not a UI preference: approval spends money and writes content the
 * client will be asked to publish, and a single mis-tap must not reach it.
 *
 * ── The copy, and the one lie it exists to correct ───────────────────────────────────
 *
 * An earlier version told clients that after this "the dates and formats are set for the month",
 * which is FALSE — every post stays editable by date until its own date passes, which is the rule
 * the whole surface is built on. Telling a client their month is locked when it is not makes them
 * rush a decision that did not need rushing, and teaches them the interface lies. The shipped
 * correction is kept verbatim.
 *
 * ── Terminology ──────────────────────────────────────────────────────────────────────
 *
 * The pill is **Generate** and the sheet asks **Ready to go?** — spec §7, where round 5 shortened
 * the pill to the single action word, and mockup 09 as rendered. The commit is **Yes, write
 * them**: "Generate" is the system's verb for a state transition, and by the time a client is
 * looking at three counts and a consequence, the honest button says what they are agreeing to.
 */
import React, { useState } from 'react';
import type { DraftBeatView } from '@/lib/types';
import { Sheet } from './Sheet';
import { Modal, type ModalChrome } from './Panel';
import { CheckGlyph, CloseGlyph } from './icons';
import { approvalCounts, approvalRows } from './approval-counts';

export function ApprovalSheet({
  open, monthLabel, beats, busy, error, onClose, onApprove, chrome,
}: {
  open: boolean;
  monthLabel: string;
  beats: readonly DraftBeatView[];
  busy: boolean;
  /** A refusal from the route — `already_approved` above all, which is a real answer and not a
   *  failure: approval spends money, so a silent second fan-out is worse than saying no. */
  error: string | null;
  onClose: () => void;
  onApprove: () => void;
  /** `modal` centres this at content width on desktop. A full-width bottom sheet is a phone
   *  shape; at 1764px it would be a wall carrying three counts. See Panel.tsx. */
  chrome: ModalChrome;
}) {
  const rows = approvalRows(approvalCounts(beats));

  if (!open) return null;

  const modal = chrome === 'modal';
  const Frame = modal ? Modal : Sheet;
  /** 40px inside a centred dialog, the surface's own 18px inside a phone sheet. */
  const pad = modal ? 'px-10' : 'px-[18px]';

  return (
    <Frame open={open} label={`Ready to go? ${monthLabel}`} testid="approval-sheet" onClose={onClose} hasOwnClose>
      <>
        {/* ── THE MODAL BREATHES; THE SHEET DOES NOT GET TO ─────────────────────────────
            One component, two frames, and the padding is the one thing that cannot be shared.
            A centred 480px dialog on a desktop can afford a 40px gutter and reads cramped
            without one; the same 40px on a 390px phone sheet would leave 310px of measure for
            a row that already carries a number column. So the generous values are scoped to
            the modal chrome, exactly as the footer's bottom inset already was.
            Tailwind's own scale throughout (`px-10` = 40, `px-8` = 32, `gap-5` = 20) — this
            surface has no separate spacing token layer, and the scale is what everything else
            here is written in. */}
        <div className={`flex flex-none items-start ${pad} ${modal ? 'gap-6 pb-7 pt-10' : 'gap-3 pb-3 pt-1.5'}`}>
          <div className="min-w-0 flex-1">
            <h2 className={`text-[20px] font-bold tracking-[-.025em] text-chrome ${modal ? 'mb-1.5' : 'mb-1'}`}>Ready to go?</h2>
            <p className="text-[13.5px] font-medium text-muted">{monthLabel}</p>
          </div>
          <button type="button" data-testid="approval-close" aria-label="Close" onClick={onClose}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-line-soft text-chrome">
            <CloseGlyph className="h-[17px] w-[17px]" />
          </button>
        </div>

        <div className={`flex-1 overflow-y-auto [scrollbar-width:none] ${pad} ${modal ? 'pb-8' : 'pb-4'}`}>
          {/* `list-none pl-0 m-0` IS LOAD-BEARING, not tidying — the same ruling DraftMonthSummary
              carries, for the same reason. Tailwind preflight is disabled on this surface
              (globals.css), so a bare `ul` keeps the browser's disc marker, its 40px
              `padding-inline-start` and its 16px block margins. The indent was eating 40 of the
              400px content box, which is what pushed "opening hooks — for the reels and
              carousels" onto two lines: the row needs 303px of text column and was being given
              264. The marker never showed only because `li` is `display: flex`, which suppresses
              the marker box — so the cost was invisible and the symptom read as a width problem. */}
          <ul data-testid="approval-counts" className={`m-0 flex list-none flex-col pl-0 pt-1 ${modal ? 'gap-5' : 'gap-3'}`}>
            {rows.map((r) => (
              <li key={r.label} className="flex items-baseline gap-3">
                {/* 44px, because a three-digit count measures 41 at this size and the old 38px
                    column would have spilled it into the gap. `tabular-nums` keeps the three
                    numerals in a column whatever their digits. */}
                <span className="w-11 flex-none text-right text-[22px] font-bold tabular-nums tracking-[-.03em] text-chrome">{r.count}</span>
                <span className="min-w-0 flex-1 text-[15px] leading-[1.4] text-muted">{r.label}</span>
              </li>
            ))}
          </ul>

          {/* The correction, verbatim. What approval actually does is start the WRITING. */}
          <p data-testid="approval-consequence" className={`text-[15px] leading-[1.5] text-chrome ${modal ? 'mt-8' : 'mt-5'}`}>
            Dates and formats stay yours to change afterwards, right up until each post’s date.
            What this starts is the writing, and it takes a few minutes.
          </p>

          {error && (
            <p data-testid="approval-error" role="alert" className="mt-4 text-[13.5px] font-semibold leading-normal text-chrome">
              {error}
            </p>
          )}
        </div>

        <div className={`flex flex-none gap-2 border-t border-line/30 bg-surface ${modal ? 'px-8 pb-8 pt-6' : 'px-[18px] pb-[26px] pt-3'}`}>
          <button
            type="button" data-testid="approve-confirm" disabled={busy || rows.length === 0} onClick={onApprove}
            className="flex min-h-[50px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-coral-650 text-[15px] font-bold text-white shadow-[0_10px_26px_-6px_rgb(var(--t-accent-600,232_112_95)_/_0.58)] disabled:bg-line-soft disabled:text-muted disabled:shadow-none"
          >
            <CheckGlyph className="h-[17px] w-[17px] [stroke-width:2.4]" />
            {busy ? 'Starting…' : 'Yes, write them'}
          </button>
          <button
            type="button" data-testid="approve-not-yet" disabled={busy} onClick={onClose}
            className="flex min-h-[50px] flex-none items-center justify-center gap-1.5 rounded-[14px] bg-surface px-4 text-[15px] font-semibold text-muted ring-1 ring-inset ring-line/55"
          >
            <CloseGlyph className="h-[15px] w-[15px]" />
            Not yet
          </button>
        </div>
      </>
    </Frame>
  );
}

/**
 * The pill in the title row: persistent, secondary weight, and it never competes with the mic.
 *
 * Hairline `accent-600` border, `accent-800` label on `surface` — accent text on white at 7.64:1,
 * which is the one place accent text is allowed to be. It states its action in a word rather than
 * asking a question, because the question is what the sheet it opens is for.
 */
export function ApprovalPill({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button" data-testid="ready-pill" disabled={busy} onClick={onClick}
      // 40px, not the mockups' 34px. This is the PRIMARY APPROVAL ACTION and it was the smallest
      // control measured under the floor (X3/B1) — the one place a missed tap costs the most.
      className="flex min-h-[40px] flex-none items-center gap-1.5 rounded-full border border-coral-600 bg-surface px-3.5 text-[13px] font-bold text-coral-800 transition-colors duration-100 active:bg-coral-100 disabled:opacity-50"
    >
      <CheckGlyph className="h-[15px] w-[15px] [stroke-width:2.4]" />
      Generate
    </button>
  );
}

/** Holds the approval call's own state, so the surface does not grow three more `useState`s. */
export function useApproval(cycleId: string | undefined) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      /**
       * THE MONTH ON SCREEN IS THE MONTH APPROVED.
       *
       * `cycleId` — the viewed cycle — has been passed into this hook since it shipped and was
       * used for exactly one thing: the redirect below, so the client LANDS on the month they
       * approved. It was never sent with the call, so the route committed `session.cycleId`
       * instead, and the redirect then carried them to a month that had not been approved at
       * all. Approval spends money and cannot be undone; the one call here that most needed to
       * name its target was the only one that did not.
       */
      const res = await fetch('/api/plan/draft/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cycleId ? { cycleId } : {}),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) {
        setError(json.message ?? 'We couldn’t start that. Try again?');
        return;
      }
      /**
       * Land on the month they just approved, BY NAME.
       *
       * A bare reload re-runs the landing rule, and approval is exactly the moment that rule
       * stops working: it moves every draft row to 'generating', so `cycleHasReviewableDraft`
       * goes false and the fallback picks a cycle by today's date — which sent earl-of-east to
       * August seconds after they approved October. "I just approved this month" is explicit
       * intent and outranks a heuristic about today.
       */
      window.location.assign(cycleId ? `/?cycle=${encodeURIComponent(cycleId)}` : '/');
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return { open, setOpen, busy, error, approve };
}
