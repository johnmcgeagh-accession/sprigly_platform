import type { PlanPost, CycleSummary } from '@/lib/types';
import { resolveTodayIso } from '@/lib/steps';
import { jakarta, dmSerif } from '@/app/fonts';
import { PlanRoot } from '@/components/plan/PlanRoot';

interface PlanRedesignProps {
  clientName: string;
  posts: PlanPost[];
  cycles: CycleSummary[];
  homeCycleId: string;
  initialCycleId?: string;
  initialReadOnly?: boolean;
}

/**
 * Flag-on plan surface (Stage 2). Server shell: self-hosts the fonts (next/font) as CSS
 * variables on the `.plan-redesign` root (which also sets color-scheme: only light) and
 * resolves "today" once, server-side, from the tenant timezone default. Everything
 * interactive lives in <PlanRoot>, which chooses the desktop or mobile layout.
 */
export default function PlanRedesign({ clientName, posts, cycles, homeCycleId, initialCycleId, initialReadOnly }: PlanRedesignProps) {
  return (
    <div className={`plan-redesign ${jakarta.variable} ${dmSerif.variable} font-sans`}>
      <PlanRoot
        clientName={clientName}
        posts={posts}
        cycles={cycles}
        homeCycleId={homeCycleId}
        initialViewedCycleId={initialCycleId}
        initialReadOnly={initialReadOnly}
        today={resolveTodayIso()}
      />
    </div>
  );
}
