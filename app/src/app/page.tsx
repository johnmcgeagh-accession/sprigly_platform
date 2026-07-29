import type { Viewport } from 'next';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, clients, clientConfigs, contentCycles, clientChannels, planInputs } from '@sprigly/db';
import { BASE_QUESTIONS, type IntakeJson } from '@sprigly/engine';
import { getSession } from '@/lib/auth';
import { loadPlanPosts, loadCrossMonthPosts, loadCycleList, beatsInMonth, cycleHasReviewableDraft, surfaceForCycle, loadDraftSurfaceContext } from '@/lib/plan';
import { editScopeToday } from '@/lib/edit-scope';
import { resolveLandingCycleId } from '@/lib/cycle-nav';
import { readPlanRedesignFlag } from '@/lib/flags';
import { loadActiveCanvasHex, CORAL_THEME_COLOR } from '@/lib/theme';
import PlanApp from '@/components/PlanApp';
import PlanRedesign from '@/components/PlanRedesign';
import { DraftPlan } from '@/components/DraftPlan';

export const dynamic = 'force-dynamic';

/**
 * `theme-color` — the colour Safari paints the status-bar and toolbar bands.
 *
 * ── The seam ─────────────────────────────────────────────────────────────────────────
 * The app handed those bands the strong coral. On a phone that reads as a coral strip, a
 * light plan, and a coral strip: three horizontal blocks, where the plan surface is supposed
 * to be one continuous sheet under the client's thumb. On the redesign the bands now take the
 * canvas, and there is no seam to see.
 *
 * DECISIONS.md §13 rules that theme-color is `coral-strong`, and THIS is the one place that
 * reverses it — for the redesign only. Two reasons it is a scoping refinement rather than a
 * reversal. That ruling was written for the marketing identity, where a coral chrome band IS
 * the brand announcing itself on arrival; the marketing site still emits it
 * (`site/app/layout.tsx:94`), untouched, and so does every flag-off tenant here. And the plan
 * surface is an Operate surface the client lives inside, where chrome that announces anything
 * is chrome competing with the plan. The brand does not get quieter — it moves to the
 * wordmark, which the header now renders in the accent at the top of the type scale.
 *
 * THE DARK ENTRY IS DELIBERATELY THE SAME COLOUR. The surface is `color-scheme: only light`
 * (globals.css); there is no dark rendering for the bands to match. Without an explicit dark
 * entry Safari substitutes its own near-black, which is the same seam in the other direction.
 *
 * Resolved from the ACTIVE theme, so an admin theme switch carries the bands along with
 * `bg-bg` rather than stranding them on a stale literal.
 */
export async function generateViewport(): Promise<Viewport> {
  const session = await getSession();
  if (!session) return { themeColor: CORAL_THEME_COLOR };
  const [cfg] = await db
    .select({ settings: clientConfigs.settings })
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, session.clientId))
    .limit(1);
  if (!readPlanRedesignFlag(cfg?.settings)) return { themeColor: CORAL_THEME_COLOR };
  const canvas = await loadActiveCanvasHex();
  return {
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: canvas },
      { media: '(prefers-color-scheme: dark)', color: canvas },
    ],
  };
}

export default async function Page({ searchParams }: { searchParams: { intake?: string; cycle?: string } }) {
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
  // An OUTSTANDING DRAFT WINS THE LANDING. The token was minted to ask the client to react
  // to a specific month; landing them on a different one — and, because the surface is
  // derived from the landed cycle, in the committed shell — answers a question they were
  // never asked. Date-based landing is otherwise unchanged and still the rule.
  //
  // Reviewable, not merely present: once the draft is approved its rows leave 'draft', the
  // predicate goes false, and the date rule takes over again by itself.
  // ?cycle= names a month explicitly — approval sends the client back to the one they just
  // approved. Ownership is enforced by membership of `cycles`, which loadCycleList already
  // scoped to this client and channel, so a foreign or stale id simply falls through to the
  // ordinary rule rather than erroring or leaking that the cycle exists.
  const initialCycleId = resolveLandingCycleId({
    cycles,
    today:                  editScopeToday(),
    homeCycleId:            session.cycleId,
    homeHasReviewableDraft: await cycleHasReviewableDraft(session.clientId, session.cycleId),
    requestedCycleId:       searchParams?.cycle,
  });
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

  // Intake question source = BASE + this channel's extra_questions (server-assembled). Also read
  // the channel's auto-run cutoff day (day-of-month the plan generates) for the "Save brief" copy.
  const [chan] = home
    ? await db.select({ extra: clientChannels.extraQuestions, schedule: clientChannels.contentCycleSchedule })
        .from(clientChannels)
        .where(and(eq(clientChannels.clientId, session.clientId), eq(clientChannels.channel, home.channel)))
        .limit(1)
    : [];
  const extraQuestions = Array.isArray(chan?.extra) ? (chan!.extra as unknown[]).filter((q): q is string => typeof q === 'string') : [];
  const questions = [...BASE_QUESTIONS, ...extraQuestions];
  const cutoffDay = chan?.schedule?.cutoffDay ?? null;   // null → neutral confirmation (no invented date)

  // Render fork behind the per-tenant plan_redesign flag (default off). Flag-off tenants
  // get the existing PlanApp untouched; flag-on tenants get the redesign shell.
  const [cfg] = await db
    .select({ settings: clientConfigs.settings })
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, session.clientId))
    .limit(1);

  // ── ONE surface decision ────────────────────────────────────────────────────
  // Every branch below is a case of the same union, derived once. Build C and D add
  // states to SurfaceKind — they do not add early returns here.
  const planRedesign = readPlanRedesignFlag(cfg?.settings);
  // ONE computation, shared with GET /api/plan so the first paint and a month switch can
  // never disagree about which surface a cycle gets (plan.ts surfaceForCycle).
  const { kind: surface, draftBeats } = await surfaceForCycle({
    clientId:           session.clientId,
    cycleId:            initialCycleId,
    committedPostCount: posts.length,             // already draft-fenced by loadPlanPosts
    planRedesign,
  });

  switch (surface) {
    case 'draft': {
      // pillars / editable / receipts come from the same helper GET /api/plan/draft uses,
      // so a draft entered by landing and one entered by a month switch render identically.
      const draftCtx = home
        ? await loadDraftSurfaceContext(session.clientId, initialCycleId, home.channel)
        : { pillars: [], editable: false, receipts: [] };

      // Flag-on tenants get the draft INSIDE the redesign shell, which owns the month
      // switcher — so a client can leave their draft month and come back to it, and the
      // surface follows them (docs/reports/draft-mode-not-rendering.md, the round trip).
      // Flag-off tenants keep the standalone render they have always had: the legacy shell
      // has no switcher, so there is nothing for the draft to sit inside.
      if (planRedesign) {
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
            cutoffDay={cutoffDay}
            initialSurfaceKind="draft"
            initialDraft={{ beats: draftBeats, ...draftCtx }}
          />
        );
      }

      return (
        <DraftPlan
          cycleId={initialCycleId}
          beats={draftBeats}
          monthLabel={cycles.find((c) => c.cycleId === initialCycleId)?.monthLabel ?? 'next month'}
          clientName={client?.name ?? 'you'}
          pillars={draftCtx.pillars}
          editable={draftCtx.editable}
          receipts={draftCtx.receipts}
        />
      );
    }

    case 'committed-redesign':
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
          cutoffDay={cutoffDay}
        />
      );

    case 'committed-legacy':
    default:
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
}

function Gate() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#FFFFFF', color: '#23272F' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 26 }}>Your plan</div>
        <p style={{ color: '#5C6470', fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>
          Open your plan from the link Sprigly emailed you. There&rsquo;s no password &mdash; the link is
          your way in.
        </p>
      </div>
    </main>
  );
}
