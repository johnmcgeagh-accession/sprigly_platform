import type { PlanPost, CycleSummary } from '@/lib/types';

interface PlanRedesignProps {
  clientName: string;
  posts: PlanPost[];
  cycles: CycleSummary[];
  homeCycleId: string;
}

/**
 * Stage 0 placeholder for the flag-on (`plan_redesign`) plan surface. It receives the
 * same props as <PlanApp> so the render fork in page.tsx is a drop-in swap. In later
 * stages this grows into the responsive <PlanDesktop>/<PlanMobile> rebuild per the
 * reference mockups (design/reference/*.html). Deliberately unstyled — no visual work yet.
 */
export default function PlanRedesign({ clientName, posts, cycles, homeCycleId }: PlanRedesignProps) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        color: '#1E2A4A',
        background: '#F8F9FB',
      }}
    >
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: '#E2574B',
          }}
        >
          Plan redesign
        </div>
        <h1 style={{ fontSize: 22, margin: '10px 0' }}>New plan surface — coming soon</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#5B647A' }}>
          The <code>plan_redesign</code> flag is on for {clientName}. This placeholder becomes the
          rebuilt desktop/mobile experience in later stages. Loaded {posts.length} post
          {posts.length === 1 ? '' : 's'} across {cycles.length} cycle
          {cycles.length === 1 ? '' : 's'}; home cycle <code>{homeCycleId}</code>.
        </p>
      </div>
    </main>
  );
}
