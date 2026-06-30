import { eq } from 'drizzle-orm';
import { db, clients } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { loadPlanPosts } from '@/lib/plan';
import PlanApp from '@/components/PlanApp';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const session = await getSession();
  if (!session) return <Gate />;

  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, session.clientId))
    .limit(1);
  const posts = await loadPlanPosts(session.clientId, session.cycleId);

  return <PlanApp clientName={client?.name ?? 'your'} posts={posts} />;
}

function Gate() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#F8F9FB', color: '#1E2A4A' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 26 }}>Your plan</div>
        <p style={{ color: '#5B647A', fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>
          Open your plan from the link Sprigly emailed you. There&rsquo;s no password &mdash; the link is
          your way in.
        </p>
      </div>
    </main>
  );
}
