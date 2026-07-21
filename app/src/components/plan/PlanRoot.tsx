'use client';

import React, { useEffect, useState } from 'react';
import { usePlanData, type PlanDataInit } from './usePlanData';
import { DraftPlan } from '../DraftPlan';
import { PlanDesktop } from './PlanDesktop';
import { PlanMobile } from './PlanMobile';
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
 * The one client root: holds the shared state hook and renders <PlanDesktop> ≥1080px,
 * <PlanMobile> below. A real layout split (not CSS), both driven by the same usePlanData.
 * Renders nothing until the breakpoint is measured (avoids an SSR/client mismatch).
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

  // THE SURFACE FOLLOWS THE VIEWED CYCLE. The kind is the server's answer for whichever
  // cycle is being shown (usePlanData.switchCycle); this switches on it rather than forking
  // on "are there drafts?", so the client can never reach a different conclusion than the
  // server did. Draft mode renders INSIDE this root — the month switcher lives here, so a
  // client can leave a draft month and come back to it.
  if (data.surfaceKind === 'draft' && data.draft) {
    return (
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
    );
  }

  return (
    <>
      {desktop === null ? null : desktop ? <PlanDesktop data={data} /> : <PlanMobile data={data} />}
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
      <Toast message={data.toast} />
    </>
  );
}
