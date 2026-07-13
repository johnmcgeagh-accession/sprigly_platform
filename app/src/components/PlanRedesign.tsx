import type { PlanPost, PlanBeat, CycleSummary } from '@/lib/types';
import { resolveTodayIso } from '@/lib/steps';
import { jakarta, dmSerif } from '@/app/fonts';
import { PlanRoot } from '@/components/plan/PlanRoot';

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
}

/**
 * Flag-on plan surface (Stage 2). Server shell: self-hosts the fonts (next/font) as CSS
 * variables on the `.plan-redesign` root (which also sets color-scheme: only light) and
 * resolves "today" once, server-side, from the tenant timezone default. Everything
 * interactive lives in <PlanRoot>, which chooses the desktop or mobile layout.
 */
export default function PlanRedesign({ clientName, posts, crossMonthPosts, beats, cycles, homeCycleId, initialCycleId, initialReadOnly, initialIntakeOpen, questions }: PlanRedesignProps) {
  return (
    <div className={`plan-redesign ${jakarta.variable} ${dmSerif.variable} font-sans`}>
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
        today={resolveTodayIso()}
      />
    </div>
  );
}
