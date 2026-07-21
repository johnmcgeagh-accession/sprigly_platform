import type { PlanPost, PlanBeat, PlanIntake, DurableItemView, CycleSummary } from '@/lib/types';
import { resolveTodayIso } from '@/lib/steps';
import { fraunces, inter, jakarta } from '@/app/fonts';
import { PlanRoot } from '@/components/plan/PlanRoot';
import type { SurfaceKind } from '@/lib/surface-state';
import type { DraftSurfaceData } from '@/components/plan/usePlanData';

interface PlanRedesignProps {
  clientName: string;
  posts: PlanPost[];
  crossMonthPosts?: PlanPost[];
  beats?: PlanBeat[];
  cycles: CycleSummary[];
  homeCycleId: string;
  initialCycleId?: string;
  initialReadOnly?: boolean;
  initialIntakeOpen?: boolean;   // landed from the Ask email's {{intakeLink}} (?intake=1)
  questions: string[];           // BASE + this channel's extra_questions (intake form source)
  intake: PlanIntake;            // the landed cycle's saved intake (form pre-fill, FIX 1)
  durable: DurableItemView[];    // client's active durable items (read-only list)
  cutoffDay?: number | null;     // auto-run cutoff day-of-month (client schedule), or null
  // The surface the server chose for the landed cycle, and the draft data when it chose
  // draft. Passed straight through — this shell decides nothing.
  initialSurfaceKind?: SurfaceKind;
  initialDraft?: DraftSurfaceData;
}

/**
 * Flag-on plan surface (Stage 2). Server shell: self-hosts the fonts (next/font) as CSS
 * variables on the `.plan-redesign` root (which also sets color-scheme: only light) and
 * resolves "today" once, server-side, from the tenant timezone default. Everything
 * interactive lives in <PlanRoot>, which chooses the desktop or mobile layout.
 */
export default function PlanRedesign({ clientName, posts, crossMonthPosts, beats, cycles, homeCycleId, initialCycleId, initialReadOnly, initialIntakeOpen, questions, intake, durable, cutoffDay, initialSurfaceKind, initialDraft }: PlanRedesignProps) {
  return (
    <div className={`plan-redesign ${fraunces.variable} ${inter.variable} ${jakarta.variable} font-sans`}>
      <PlanRoot
        clientName={clientName}
        posts={posts}
        crossMonthPosts={crossMonthPosts ?? []}
        beats={beats ?? []}
        cycles={cycles}
        homeCycleId={homeCycleId}
        initialViewedCycleId={initialCycleId}
        initialReadOnly={initialReadOnly}
        initialIntakeOpen={initialIntakeOpen}
        questions={questions}
        intake={intake}
        durable={durable}
        cutoffDay={cutoffDay ?? null}
        initialSurfaceKind={initialSurfaceKind}
        initialDraft={initialDraft}
        today={resolveTodayIso()}
      />
    </div>
  );
}
