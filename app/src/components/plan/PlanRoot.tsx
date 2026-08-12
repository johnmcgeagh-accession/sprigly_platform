'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePlanData, type PlanDataInit } from './usePlanData';
import { readNavState, urlNamesCycle } from './nav-state';
import { navTrace } from './nav-trace';
import { CommittedSurface } from './surface/CommittedSurface';
import { DraftSurface } from './surface/DraftSurface';
import { IntakeCapture } from './IntakeCapture';
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
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /**
   * F2 — RESTORE THE MONTH THE TAB WAS STANDING ON.
   *
   * The landing (`page.tsx` → `resolveLandingCycleId`) is a heuristic for a FRESH arrival. On a
   * reload nobody pressed — iOS Safari reloading an evicted tab, pull-to-refresh — it re-runs
   * and can land a different month from the one the client had navigated to, which reads as the
   * plan jumping in time. The tab's own stored position (`nav-state.ts`) is not a guess, so on
   * mount it outranks the heuristic; an explicit `?cycle=` in the URL (the approval redirect)
   * outranks both. Phone surfaces only — the desktop shell holds no per-day position.
   */
  const restored = useRef(false);
  const { viewedCycleId, cycles, switchCycle } = data;
  useEffect(() => {
    if (desktop !== false || restored.current) return;
    restored.current = true;
    navTrace('land mount', viewedCycleId);
    if (urlNamesCycle()) return;                                   // explicit intent wins
    const stored = readNavState();
    if (!stored || stored.cycleId === viewedCycleId) return;
    if (!cycles.some((c) => c.cycleId === stored.cycleId)) return; // stale or foreign → ignore
    navTrace('cycle restore:session', stored.cycleId);
    void switchCycle(stored.cycleId);
  }, [desktop, viewedCycleId, cycles, switchCycle]);

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
   * On DESKTOP it is now the SAME COMPONENT in a different frame. `DraftPlan` — 654 lines of
   * standalone page with its own header, month pills and hard-coded colour object — is no longer
   * reachable at any width, and `PlanDesktop` with it. Everything width-agnostic crossed over by
   * being reused rather than reimplemented: the detail view, the conversation, the summary panel,
   * the approval consequence, the month control and its arrows.
   *
   * `key` remounts the surface on a month switch, so a client returning to a draft month cannot
   * see the month they left: the surface holds the selected day and the highlight marks in local
   * state, and both belong to one month. The frame is in the key too — the two shells hold
   * different view enums, and carrying one across a resize would restore a position the other
   * has no word for.
   */
  /**
   * THE WIZARD IS A SIBLING OF BOTH SURFACES, not a child of one.
   *
   * It used to be mounted inside the committed branch's fragment, BELOW the draft early return
   * — so on a draft month `?intake=1` opened nothing and `openIntake` had nowhere to lead. That
   * made the two ways of briefing a month mutually exclusive by tree position rather than by
   * intent: a client looking at a proposed month could reshape it by voice but could not brief
   * it in bulk, which is exactly the case a wizard is for.
   *
   * Derived once, rendered in both returns. The overlay is `fixed inset-0 z-[60]`, so it sits
   * above whichever surface is behind it without either needing to know it exists.
   *
   * On a draft month it is told so: the composer opens EMPTY there and shows the current beats
   * as context instead of the stored brief text. See IntakeCapture for why — after the client
   * has moved a beat on the draft surface, the sentence that produced it is no longer what the
   * month says, and seeding it back would invite them to re-submit a description of a month
   * that has since changed.
   */
  const intakeNode = data.intakeOpen ? (
    <IntakeCapture
      questions={data.questions}
      cycleId={data.viewedCycleId}
      prePlanning={data.viewedCyclePrePlanning}
      busy={data.intakeBusy}
      monthLabel={viewedMonthLabel}
      intake={data.intake}
      savedExtraction={data.savedExtraction}
      durable={data.durable}
      cutoffLabel={cutoffLabel}
      draftMonth={isDraft}
      currentBeats={isDraft ? (data.draft?.beats ?? []) : []}
      onSubmit={data.submitIntake}
      onClose={data.closeIntake}
    />
  ) : null;

  if (isDraft && data.draft) {
    return (
      <>
        <DraftSurface key={`${data.viewedCycleId}:${desktop ? 'd' : 'm'}`} data={data} frame={desktop ? 'desktop' : 'mobile'} />
        {intakeNode}
      </>
    );
  }

  return (
    <>
      <CommittedSurface key={desktop ? 'd' : 'm'} data={data} frame={desktop ? 'desktop' : 'mobile'} />
      {intakeNode}
    </>
  );
}
