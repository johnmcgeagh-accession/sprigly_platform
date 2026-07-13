'use client';

import React, { useEffect, useState } from 'react';
import { usePlanData, type PlanDataInit } from './usePlanData';
import { PlanDesktop } from './PlanDesktop';
import { PlanMobile } from './PlanMobile';
import { IntakeCapture } from './IntakeCapture';
import { Toast } from './primitives';

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

  const viewedMonthLabel = data.cycles.find((c) => c.cycleId === data.viewedCycleId)?.monthLabel ?? 'this month';

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
          onSubmit={data.submitIntake}
          onClose={data.closeIntake}
        />
      )}
      <Toast message={data.toast} />
    </>
  );
}
