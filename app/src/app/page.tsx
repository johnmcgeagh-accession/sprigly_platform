import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, clients, clientConfigs, contentCycles, clientChannels, planInputs } from '@sprigly/db';
import { BASE_QUESTIONS, type IntakeJson } from '@sprigly/engine';
import { getSession } from '@/lib/auth';
import { loadPlanPosts, loadCrossMonthPosts, loadCycleList, beatsInMonth } from '@/lib/plan';
import { editScopeToday } from '@/lib/edit-scope';
import { resolveDayCycleId } from '@/lib/cycle-nav';
import { readPlanRedesignFlag } from '@/lib/flags';
import PlanApp from '@/components/PlanApp';
import PlanRedesign from '@/components/PlanRedesign';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: { intake?: string } }) {
  const session = await getSession();
  if (!session) return <Gate />;
  // Landed from the Ask email's {{intakeLink}} (…/p/<token>?intake=1 → /?intake=1).
  const initialIntakeOpen = searchParams?.intake === '1';

  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, session.clientId))
    .limit(1);

  // The switcher lists the client's qualifying months for the HOME cycle's channel
  // (per-channel months don't mix in slice 1). The home cycle is the only editable one.
  const [home] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(eq(contentCycles.id, session.cycleId))
    .limit(1);

  const cycles = home
    ? await loadCycleList(session.clientId, home.channel, session.cycleId)
    : [];

  // DEFAULT LANDING = TODAY. Land on the cycle whose plan month contains today (London,
  // server-computed — the SAME editScopeToday source as the edit gate), else the nearest
  // future cycle, else the most recent past one (see resolveDayCycleId). This supersedes
  // the old token-home landing AND the newest-populated fallback. Editability is per-post
  // by date, so the landed cycle is fully editable for its today-onward posts;
  // `initialReadOnly` is retained only for the prop shape.
  const initialReadOnly = false;
  const initialCycleId  = resolveDayCycleId(cycles, editScopeToday()) ?? session.cycleId;
  const posts = await loadPlanPosts(session.clientId, initialCycleId);
  // Cross-cycle posts dated in the landed cycle's plan month, so the calendar grid is
  // date-authoritative from first paint (see loadCrossMonthPosts).
  const initialMonth   = cycles.find((c) => c.cycleId === initialCycleId)?.displayMonth;
  const crossMonthPosts = home && initialMonth
    ? await loadCrossMonthPosts(session.clientId, home.channel, initialMonth, initialCycleId)
    : [];

  // Beats + saved intake (FIX 1) for the landed cycle.
  const [landed] = await db
    .select({ structuredBrief: contentCycles.structuredBrief, intakeJson: contentCycles.intakeJson })
    .from(contentCycles)
    .where(eq(contentCycles.id, initialCycleId))
    .limit(1);
  const beats = initialMonth ? beatsInMonth(landed?.structuredBrief, initialMonth) : [];
  const landedPlanContent = (landed?.intakeJson as IntakeJson | null)?.planContent ?? { answers: {}, freeNotes: '' };
  const intake = { answers: landedPlanContent.answers ?? {}, freeNotes: landedPlanContent.freeNotes ?? '' };
  const durableRows = await db
    .select({ id: planInputs.id, type: planInputs.type, content: planInputs.content, createdAt: planInputs.createdAt })
    .from(planInputs)
    .where(and(eq(planInputs.clientId, session.clientId), inArray(planInputs.type, ['idea', 'next_cycle']), eq(planInputs.status, 'active')))
    .orderBy(desc(planInputs.createdAt));
  const durable = durableRows.map((r) => ({ id: r.id, type: r.type, content: r.content, createdAt: r.createdAt.toISOString() }));

  // Intake question source = BASE + this channel's extra_questions (server-assembled).
  const [chan] = home
    ? await db.select({ extra: clientChannels.extraQuestions })
        .from(clientChannels)
        .where(and(eq(clientChannels.clientId, session.clientId), eq(clientChannels.channel, home.channel)))
        .limit(1)
    : [];
  const extraQuestions = Array.isArray(chan?.extra) ? (chan!.extra as unknown[]).filter((q): q is string => typeof q === 'string') : [];
  const questions = [...BASE_QUESTIONS, ...extraQuestions];

  // Render fork behind the per-tenant plan_redesign flag (default off). Flag-off tenants
  // get the existing PlanApp untouched; flag-on tenants get the redesign shell.
  const [cfg] = await db
    .select({ settings: clientConfigs.settings })
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, session.clientId))
    .limit(1);

  if (readPlanRedesignFlag(cfg?.settings)) {
    return (
      <PlanRedesign
        clientName={client?.name ?? 'your'}
        posts={posts}
        crossMonthPosts={crossMonthPosts}
        beats={beats}
        cycles={cycles}
        homeCycleId={session.cycleId}
        initialCycleId={initialCycleId}
        initialReadOnly={initialReadOnly}
        initialIntakeOpen={initialIntakeOpen}
        questions={questions}
        intake={intake}
        durable={durable}
      />
    );
  }

  return (
    <PlanApp
      clientName={client?.name ?? 'your'}
      posts={posts}
      cycles={cycles}
      homeCycleId={session.cycleId}
      initialCycleId={initialCycleId}
      initialReadOnly={initialReadOnly}
    />
  );
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
