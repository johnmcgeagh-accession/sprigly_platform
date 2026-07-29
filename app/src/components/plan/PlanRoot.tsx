'use client';

import React, { useEffect, useState } from 'react';
import { usePlanData, type PlanDataInit } from './usePlanData';
import { DraftPlan } from '../DraftPlan';
import { PlanDesktop } from './PlanDesktop';
import { CommittedSurface } from './surface/CommittedSurface';
import { DraftSurface } from './surface/DraftSurface';
import { IntakeCapture } from './IntakeCapture';
import { Toast } from './primitives';
import { prevMonth } from '@/lib/cycle-nav';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 'YYYY-MM' + day → '18 July' (the auto-run cutoff for a cycle whose run month is `cycleMonth`). */
function cutoffLabelFor(cycleMonth: string, day: number): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(cycleMonth);
  if (!m) return null;
  return `${day} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim();
}

/**
 * The one client root: holds the shared state hook and forks on viewport, then on surface.
 *
 * ── The structural change ────────────────────────────────────────────────────────────
 *
 * This file used to return `DraftPlan` BEFORE the desktop/mobile fork was reached, which meant
 * the draft surface had no responsive shell at all — spec §1.3 names that as the single largest
 * piece of work the redesign implies. The order is now inverted:
 *
 *     viewport  →  desktop | mobile
 *                     └── surface  →  draft | committed
 *
 * Both surfaces are now inside the fork, so the draft month is a BRANCH of a form factor
 * rather than a page that pre-empts one. That is the reconciliation: Session B's job is to
 * swap the mobile draft branch below for the same `PlanShell` the committed branch already
 * uses, and nothing else moves.
 *
 * Desktop is untouched by this build, deliberately. `PlanDesktop` renders the same month grid
 * it always has, behind the same ≥1080px breakpoint; its own redesign is a later session and
 * the shell must not break it in the meantime. What crosses over when that session runs is
 * everything width-agnostic — the detail sheet (as a right-hand panel or centred modal), the
 * summary chip, the approval sheet — plus, first and most cheaply, the month control and its
 * arrows, because "October doesn't show" was a DESKTOP report: `PlanDesktop` navigates by
 * prev/next by index with no visible month name, which put October two blind taps away. The
 * left rail is where `PlanShell`'s nav pill adapts: the same three views, laid out vertically,
 * with the mic staying a separate control rather than becoming a rail item.
 */
export function PlanRoot(props: PlanDataInit) {
  const data = usePlanData(props);
  const [desktop, setDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1080px)');
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const viewedCycle = data.cycles.find((c) => c.cycleId === data.viewedCycleId);
  const viewedMonthLabel = viewedCycle?.monthLabel ?? 'this month';
  // The cutoff for the VIEWED cycle: its run month is prevMonth(displayMonth), the cutoff fires on
  // the client's cutoffDay of that month. null when the client has no cutoffDay (neutral copy).
  const cutoffLabel = props.cutoffDay && viewedCycle ? cutoffLabelFor(prevMonth(viewedCycle.displayMonth), props.cutoffDay) : null;

  // THE SURFACE FOLLOWS THE VIEWED CYCLE. The kind is the server's answer for whichever cycle
  // is being shown (usePlanData.switchCycle); this switches on it rather than forking on "are
  // there drafts?", so the client can never reach a different conclusion than the server did.
  const isDraft = data.surfaceKind === 'draft' && !!data.draft;

  // Nothing renders until the breakpoint is measured (avoids an SSR/client mismatch).
  if (desktop === null) return null;

  /**
   * Draft month.
   *
   * ── The move Session A left one `if` away ──────────────────────────────────────────
   *
   * On a PHONE the draft month is now `DraftSurface`, which is `PlanShell` with different
   * children — the same frame, strip, grid, nav pill and sheets the committed month uses. That
   * was the point of inverting the fork: reconciling the two shells is what spec §1.3 named as
   * the single largest piece of work the redesign implies, and this is it.
   *
   * On DESKTOP it is still `DraftPlan`, deliberately. `PlanDesktop`'s own redesign is a later
   * session and the shell must not break it in the meantime; what crosses over when that session
   * runs is everything width-agnostic — the detail sheet as a right-hand panel, the summary chip,
   * the approval sheet — plus the month control and its arrows.
   *
   * `key` remounts the surface on a month switch, so a client returning to a draft month cannot
   * see the month they left: `DraftSurface` holds the selected day and the highlight marks in
   * local state, and both belong to one month.
   */
  if (isDraft && data.draft) {
    return desktop ? (
      <DraftPlan
        beats={data.draft.beats}
        monthLabel={viewedMonthLabel}
        clientName={data.clientName}
        pillars={data.draft.pillars}
        editable={data.draft.editable}
        receipts={data.draft.receipts}
        cycles={data.cycles}
        viewedCycleId={data.viewedCycleId}
        cycleId={data.viewedCycleId}
        onSwitchCycle={data.switchCycle}
        switching={data.switching}
      />
    ) : (
      <DraftSurface key={data.viewedCycleId} data={data} />
    );
  }

  return (
    <>
      {desktop ? <PlanDesktop data={data} /> : <CommittedSurface data={data} />}
      {/* ROUND 6, P10 — ONE feedback channel on the phone, and it is the shell's TOP slot.
          This bottom toast was the second one: a confirmation landed at the top, and the
          confirmation of the very next act landed here, over the nav pill. Desktop keeps it,
          because `PlanDesktop` has no top slot to move it into and its own redesign is a later
          session; the shell must not break it in the meantime. */}
      {desktop && <Toast message={data.toast} />}
      {data.intakeOpen && (
        <IntakeCapture
          questions={data.questions}
          prePlanning={data.viewedCyclePrePlanning}
          busy={data.intakeBusy}
          monthLabel={viewedMonthLabel}
          intake={data.intake}
          durable={data.durable}
          cutoffLabel={cutoffLabel}
          onSubmit={data.submitIntake}
          onClose={data.closeIntake}
        />
      )}
    </>
  );
}
