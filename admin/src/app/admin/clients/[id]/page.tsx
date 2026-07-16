export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { formatDateTimeShort } from '@/lib/format-date';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, clients, clientConfigs, clientChannels, oauthConnections, incomingEvents, routingRules, promptTemplates, workflowRuns, contentCycles, clientPlanningConfig, planInputs } from '@sprigly/db';
import { eq, desc, and, isNull, sql, inArray } from 'drizzle-orm';
import { workflowMeta, type WorkflowMeta } from '@sprigly/workflows';
import { getTokens, storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient, type DriveFileMeta } from '@sprigly/sources';
import { customisePrompt, approveQaDraft } from './actions';
import { StepModelForm } from './StepModelForm';
import { ContentCycleSettingsForm } from './ContentCycleSettingsForm';
import { ContentCycleOpsPanel } from './ContentCycleOpsPanel';
import { IntakePanel } from './IntakePanel';
import { BASE_QUESTIONS } from '@sprigly/engine';
import type { IntakeJson } from '@sprigly/engine';

type PromptRow = { id: string; clientId: string | null; workflowId: string; stepName: string; version: number };

type StepCoverage = {
  step: WorkflowMeta['steps'][number];
  clientSpecific: PromptRow | undefined;
  sharedDefault: PromptRow | undefined;
};

type WorkflowCoverage =
  | { workflowId: string; workflowName: string; missing: true; steps: [] }
  | { workflowId: string; workflowName: string; missing: false; steps: StepCoverage[] };

async function getClient(id: string) {
  const rows = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  return rows[0] ?? null;
}

async function getClientConfig(clientId: string) {
  const rows = await db
    .select()
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, clientId))
    .limit(1);
  return rows[0] ?? null;
}

// ── dataMonth helpers (Europe/London, last completed month) ──────────────────
function getLondonToday() {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  return {
    year:  parseInt(parts.find(p => p.type === 'year')?.value  ?? '2000', 10),
    month: parseInt(parts.find(p => p.type === 'month')?.value ?? '1',    10),
  };
}
function getDataMonth(): string {
  const { year, month } = getLondonToday();
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12       : month - 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
// Intake-workflow cohort (clients WITH a cutoffDay): the cycle is at the CURRENT month (FIX 3).
function getCurrentMonth(): string {
  const { year, month } = getLondonToday();
  return `${year}-${String(month).padStart(2, '0')}`;
}
/** Plan-month label ("August 2026") for a cycle's cycle_month ('YYYY-MM' → +1 month). */
function planMonthLabelOf(cycleMonth: string): string {
  const [y, m] = cycleMonth.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The client's most-recent cycle month (cycle_month is 'YYYY-MM', so lexical desc =
 *  chronological). Used to anchor the page to the latest cycle (incl. on-demand cycles
 *  whose month is not the calendar data month); null when the client has no cycles. */
async function getMostRecentCycleMonth(clientId: string): Promise<string | null> {
  const rows = await db
    .select({ m: contentCycles.cycleMonth })
    .from(contentCycles)
    .where(eq(contentCycles.clientId, clientId))
    .orderBy(desc(contentCycles.cycleMonth))
    .limit(1);
  return rows[0]?.m ?? null;
}

async function getClientChannels(clientId: string) {
  return db
    .select({
      channel:              clientChannels.channel,
      driveFolderId:        clientChannels.driveFolderId,
      instagramHandle:      clientChannels.instagramHandle,
      contactEmail:         clientChannels.contactEmail,
      contactName:          clientChannels.contactName,
      contentCycleSchedule: clientChannels.contentCycleSchedule,
      extraQuestions:       clientChannels.extraQuestions,
      deliverySurface:      clientChannels.deliverySurface,
      aiChangeLimit:        clientChannels.aiChangeLimit,
      aiChangeLimitOverrideUntil: clientChannels.aiChangeLimitOverrideUntil,
      postsPerWeek:         clientChannels.postsPerWeek,
    })
    .from(clientChannels)
    .where(eq(clientChannels.clientId, clientId));
}

type CycleInfo = {
  id:            string;
  status:        string;
  requestSentAt: string | null;
  intakeJson:    IntakeJson | null;
  igInputStatus: string | null;
  igInputDetail: string | null;
  postsSyncStatus: string | null;
  postsSyncedAt:   string | null;  // ISO; provenance for a verified 'synced' (0061)
  postsSyncedRunId: string | null;
  // Intake-capture (Build 4) — send-log stamps + whether input has landed (for the readout).
  askSentAt:       string | null;
  nudgeSentAt:     string | null;
  lastCallSentAt:  string | null;
  // Per-beat skip reason (0080) — WHY a NULL *_sent_at happened. 'has_input'|'send_failed'|
  // 'no_sender_wired'|'error'|null (null = unknown / predates the column).
  askSkipReason:      string | null;
  nudgeSkipReason:    string | null;
  lastCallSkipReason: string | null;
  inputLanded:     boolean;
};

/** Mirror of the sender's hasIntakeContent (worker) — any non-empty answer or free notes. */
function hasIntakeContent(intake: IntakeJson | null): boolean {
  const answers = intake?.planContent?.answers ?? {};
  const freeNotes = (intake?.planContent?.freeNotes ?? '').trim();
  return freeNotes.length > 0 || Object.values(answers).some((v) => (v ?? '').trim().length > 0);
}

async function getCompetitorsByChannel(
  clientId: string,
  channelNames: string[],
): Promise<Map<string, string[]>> {
  if (channelNames.length === 0) return new Map();
  const rows = await db
    .select({ channel: clientPlanningConfig.channel, competitors: clientPlanningConfig.competitors })
    .from(clientPlanningConfig)
    .where(and(eq(clientPlanningConfig.clientId, clientId), inArray(clientPlanningConfig.channel, channelNames)));
  return new Map(rows.map((r) => [r.channel, (r.competitors ?? []) as string[]]));
}

async function getCyclesByChannel(
  clientId: string,
  channelNames: string[],
  dataMonth: string,
): Promise<Map<string, CycleInfo>> {
  if (channelNames.length === 0) return new Map();
  const rows = await db
    .select({
      channel:       contentCycles.channel,
      id:            contentCycles.id,
      status:        contentCycles.status,
      requestSentAt: contentCycles.requestSentAt,
      intakeJson:    contentCycles.intakeJson,
      igInputStatus: contentCycles.igInputStatus,
      igInputDetail: contentCycles.igInputDetail,
      postsSyncStatus: contentCycles.postsSyncStatus,
      postsSyncedAt:   contentCycles.postsSyncedAt,
      postsSyncedRunId: contentCycles.postsSyncedRunId,
      askSentAt:       contentCycles.askSentAt,
      nudgeSentAt:     contentCycles.nudgeSentAt,
      lastCallSentAt:  contentCycles.lastCallSentAt,
      askSkipReason:      contentCycles.askSkipReason,
      nudgeSkipReason:    contentCycles.nudgeSkipReason,
      lastCallSkipReason: contentCycles.lastCallSkipReason,
      createdAt:       contentCycles.createdAt,
    })
    .from(contentCycles)
    .where(
      and(
        eq(contentCycles.clientId,   clientId),
        eq(contentCycles.cycleMonth, dataMonth),
        inArray(contentCycles.channel, channelNames),
      ),
    );
  // Durable inputs (active idea|next_cycle) for the client — for the "input landed" flag we
  // count those created at/after the cycle (mirrors the sender's hasAnyIntakeInput recency bound).
  const durable = await db
    .select({ createdAt: planInputs.createdAt })
    .from(planInputs)
    .where(and(
      eq(planInputs.clientId, clientId),
      inArray(planInputs.type, ['idea', 'next_cycle']),
      eq(planInputs.status, 'active'),
    ));
  return new Map(rows.map(r => [r.channel, {
    id:            r.id,
    status:        r.status,
    requestSentAt: r.requestSentAt ? r.requestSentAt.toISOString() : null,
    intakeJson:    (r.intakeJson as IntakeJson | null) ?? null,
    igInputStatus: r.igInputStatus ?? null,
    igInputDetail: r.igInputDetail ?? null,
    postsSyncStatus: r.postsSyncStatus ?? null,
    postsSyncedAt:   r.postsSyncedAt ? r.postsSyncedAt.toISOString() : null,
    postsSyncedRunId: r.postsSyncedRunId ?? null,
    askSentAt:       r.askSentAt ? r.askSentAt.toISOString() : null,
    nudgeSentAt:     r.nudgeSentAt ? r.nudgeSentAt.toISOString() : null,
    lastCallSentAt:  r.lastCallSentAt ? r.lastCallSentAt.toISOString() : null,
    // Plain text columns (not Dates) — pass through as-is.
    askSkipReason:      r.askSkipReason ?? null,
    nudgeSkipReason:    r.nudgeSkipReason ?? null,
    lastCallSkipReason: r.lastCallSkipReason ?? null,
    inputLanded:     hasIntakeContent((r.intakeJson as IntakeJson | null) ?? null) || durable.some((d) => d.createdAt >= r.createdAt),
  }]));
}

async function getDriveFilesByChannel(
  clientId: string,
  channelFolders: { channel: string; driveFolderId: string | null }[],
): Promise<Map<string, { files: DriveFileMeta[] | null; error: boolean }>> {
  const result = new Map<string, { files: DriveFileMeta[] | null; error: boolean }>();
  const foldersToFetch = channelFolders.filter(c => c.driveFolderId);
  if (foldersToFetch.length === 0) {
    channelFolders.forEach(c => result.set(c.channel, { files: null, error: false }));
    return result;
  }
  try {
    const encProvider = createEncryptionProvider();
    const tokens = await getTokens(db, encProvider, clientId, 'drive');
    if (!tokens) {
      channelFolders.forEach(c => result.set(c.channel, { files: null, error: false }));
      return result;
    }
    const drive = new DriveApiClient(
      process.env.GOOGLE_CLIENT_ID  ?? '',
      process.env.GOOGLE_CLIENT_SECRET ?? '',
      tokens,
      async (t) => {
        try { await storeTokens(db, encProvider, clientId, 'drive', t); } catch { /* best-effort */ }
      },
    );
    await Promise.all(
      channelFolders.map(async ({ channel, driveFolderId }) => {
        if (!driveFolderId) { result.set(channel, { files: null, error: false }); return; }
        try {
          const files = await drive.listFiles(driveFolderId);
          result.set(channel, { files, error: false });
        } catch {
          result.set(channel, { files: null, error: true });
        }
      }),
    );
  } catch {
    channelFolders.forEach(c => result.set(c.channel, { files: null, error: true }));
  }
  return result;
}

async function getOAuthConnections(clientId: string) {
  return db
    .select({
      id: oauthConnections.id,
      provider: oauthConnections.provider,
      emailAddress: oauthConnections.emailAddress,
      status: oauthConnections.status,
      scopes: oauthConnections.scopes,
      createdAt: oauthConnections.createdAt,
    })
    .from(oauthConnections)
    .where(eq(oauthConnections.clientId, clientId));
}

async function getRecentEvents(clientId: string) {
  return db
    .select({
      id: incomingEvents.id,
      source: incomingEvents.source,
      status: incomingEvents.status,
      receivedAt: incomingEvents.receivedAt,
    })
    .from(incomingEvents)
    .where(eq(incomingEvents.clientId, clientId))
    .orderBy(desc(incomingEvents.receivedAt))
    .limit(10);
}

type QaDraft = {
  id: string;
  startedAt: Date;
  cleanQuestion: string | null;
  draftText: string | null;
};

async function getPendingQaDrafts(clientId: string): Promise<QaDraft[]> {
  const rows = await db
    .select({ id: workflowRuns.id, startedAt: workflowRuns.startedAt, output: workflowRuns.output })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.clientId, clientId),
        eq(workflowRuns.workflowId, 'sprigly-question-answerer'),
        sql`${workflowRuns.output}->>'gmailDraftId' IS NOT NULL`,
        sql`${workflowRuns.output}->>'feedbackIngestedAt' IS NULL`,
        sql`${workflowRuns.output}->>'feedbackDiscardedAt' IS NULL`,
      ),
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(20);

  return rows.map((r) => {
    const o = r.output as { cleanQuestion?: string; draftText?: string } | null;
    return {
      id:            r.id,
      startedAt:     r.startedAt,
      cleanQuestion: o?.cleanQuestion ?? null,
      draftText:     o?.draftText ?? null,
    };
  });
}

async function getClientRoutingRules(clientId: string) {
  return db
    .select({ workflowId: routingRules.workflowId })
    .from(routingRules)
    .where(eq(routingRules.clientId, clientId));
}

async function getPromptCoverage(clientId: string, workflowIds: string[]): Promise<WorkflowCoverage[]> {
  if (workflowIds.length === 0) return [];

  const allPrompts = await db
    .select({
      id: promptTemplates.id,
      clientId: promptTemplates.clientId,
      workflowId: promptTemplates.workflowId,
      stepName: promptTemplates.stepName,
      version: promptTemplates.version,
    })
    .from(promptTemplates)
    .orderBy(promptTemplates.workflowId, promptTemplates.stepName, desc(promptTemplates.version));

  const seen = new Set<string>();
  const latest = allPrompts.filter((p) => {
    const key = `${p.clientId ?? 'global'}-${p.workflowId}-${p.stepName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const uniqueWorkflowIds = [...new Set(workflowIds)];

  return uniqueWorkflowIds.map((workflowId): WorkflowCoverage => {
    const wf = workflowMeta.find((w) => w.id === workflowId);
    if (!wf) {
      return { workflowId, workflowName: workflowId, missing: true, steps: [] };
    }

    const steps: StepCoverage[] = wf.steps
      .filter((s) => s.requiresPrompt)
      .map((step) => ({
        step,
        clientSpecific: latest.find(
          (p) => p.clientId === clientId && p.workflowId === workflowId && p.stepName === step.stepName,
        ),
        sharedDefault: latest.find(
          (p) => p.clientId === null && p.workflowId === workflowId && p.stepName === step.stepName,
        ),
      }));

    return { workflowId, workflowName: wf.name, missing: false, steps };
  });
}

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const [client, config, channels, connections, events, clientRules, pendingQaDrafts, mostRecentCycleMonth] = await Promise.all([
    getClient(params.id),
    getClientConfig(params.id),
    getClientChannels(params.id),
    getOAuthConnections(params.id),
    getRecentEvents(params.id),
    getClientRoutingRules(params.id),
    getPendingQaDrafts(params.id),
    getMostRecentCycleMonth(params.id),
  ]);

  // Anchor the page to the client's MOST RECENT cycle by cycle_month, so an on-demand
  // cycle (whose month need not equal the calendar data month) is selectable and its
  // actions (Copy client link, Run planning now, …) bind to it. Falls back to the
  // calendar data month when the client has no cycles yet. Only the bound month changes;
  // no action's behaviour changes.
  const dataMonth = mostRecentCycleMonth ?? getDataMonth();

  if (!client) notFound();

  const channelNames = channels.map(c => c.channel);
  const currentMonth = getCurrentMonth();   // intake cohort's cycle month (FIX 3)
  const [promptCoverage, cyclesByChannel, cyclesByChannelCurrent, driveByChannel, competitorsByChannel] = await Promise.all([
    getPromptCoverage(params.id, clientRules.map((r) => r.workflowId)),
    getCyclesByChannel(params.id, channelNames, dataMonth),
    getCyclesByChannel(params.id, channelNames, currentMonth),   // for the intake-cohort readout
    getDriveFilesByChannel(params.id, channels.map(c => ({ channel: c.channel, driveFolderId: c.driveFolderId ?? null }))),
    getCompetitorsByChannel(params.id, channelNames),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          slug: <span className="font-mono">{client.slug}</span> · status: {client.status}
        </p>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Config</h2>
        {config ? (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">Author</dt>
              <dd className="text-gray-900 mt-0.5">{config.authorName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Signature</dt>
              <dd className="text-gray-900 mt-0.5">{config.signature ?? '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-gray-500">Brand voice</dt>
              <dd className="text-gray-900 mt-0.5 whitespace-pre-wrap">{config.brandVoice ?? '—'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-400">No config record.</p>
        )}
      </section>

      {/* Content Cycle Settings */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Content Cycle Settings</h2>
        <p className="text-xs text-gray-400 mb-4">
          Per-channel config for the monthly content-request email pipeline.
          Fields save automatically on blur.
        </p>
        {channels.length === 0 ? (
          <p className="text-sm text-gray-400">No channel rows configured — add a client_channels record to enable.</p>
        ) : (
          <div className="space-y-8">
            {channels.map((ch) => (
              <div key={ch.channel}>
                {channels.length > 1 && (
                  <p className="text-xs font-mono text-gray-500 mb-3">{ch.channel}</p>
                )}
                <ContentCycleSettingsForm
                  key={`${ch.channel}-${String(client.contentCycleEnabled)}`}
                  clientId={params.id}
                  clientName={client.name}
                  channel={ch.channel}
                  instagramHandle={ch.instagramHandle ?? null}
                  contactEmail={ch.contactEmail ?? null}
                  contactName={ch.contactName ?? null}
                  contentCycleSchedule={ch.contentCycleSchedule ?? null}
                  extraQuestions={ch.extraQuestions ?? null}
                  contentCycleEnabled={client.contentCycleEnabled}
                  currentCycle={(() => {
                    // FIX 3 cohort: a client WITH a cutoffDay runs on the CURRENT-month cycle; a
                    // legacy client (no cutoffDay) on the data-month cycle. Read the right one.
                    const intakeCohort = ch.contentCycleSchedule?.cutoffDay != null;
                    const cohortMonth = intakeCohort ? currentMonth : dataMonth;
                    const c = (intakeCohort ? cyclesByChannelCurrent : cyclesByChannel).get(ch.channel);
                    if (!c) return null;
                    return { monthLabel: planMonthLabelOf(cohortMonth), askSentAt: c.askSentAt, nudgeSentAt: c.nudgeSentAt, lastCallSentAt: c.lastCallSentAt, askSkipReason: c.askSkipReason, nudgeSkipReason: c.nudgeSkipReason, lastCallSkipReason: c.lastCallSkipReason, inputLanded: c.inputLanded };
                  })()}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Content Cycle Operations */}
      {channels.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Content Cycle Operations</h2>
          <p className="text-xs text-gray-400 mb-5">
            Readiness checks, Drive folder view, and manual triggers for the monthly content-request email pipeline.
          </p>
          <div className="space-y-10">
            {channels.map((ch) => {
              const cycle = cyclesByChannel.get(ch.channel) ?? null;
              const driveResult = driveByChannel.get(ch.channel) ?? { files: null, error: false };
              const pc = cycle?.intakeJson?.planContent;
              const intakePresent = !!pc && (
                (pc.freeNotes ?? '').trim().length > 0 ||
                Object.values(pc.answers ?? {}).some((v) => (v ?? '').trim().length > 0)
              );
              return (
                <div key={ch.channel}>
                  {channels.length > 1 && (
                    <p className="text-xs font-mono text-gray-500 mb-4">{ch.channel}</p>
                  )}
                  <ContentCycleOpsPanel
                    clientId={params.id}
                    clientName={client.name}
                    channel={ch.channel}
                    dataMonth={dataMonth}
                    instagramHandle={ch.instagramHandle ?? null}
                    contactEmail={ch.contactEmail ?? null}
                    contentCycleEnabled={client.contentCycleEnabled}
                    cycle={cycle}
                    deliverySurface={(ch.deliverySurface as 'app' | 'sheet' | 'both') ?? 'both'}
                    aiChangeLimit={ch.aiChangeLimit ?? 30}
                    aiChangeLimitOverrideUntil={ch.aiChangeLimitOverrideUntil ? ch.aiChangeLimitOverrideUntil.toISOString() : null}
                    postsPerWeek={ch.postsPerWeek ?? null}
                    competitors={competitorsByChannel.get(ch.channel) ?? []}
                    igInputStatus={cycle?.igInputStatus ?? null}
                    igInputDetail={cycle?.igInputDetail ?? null}
                    intakePresent={intakePresent}
                    driveFiles={driveResult.files}
                    driveError={driveResult.error}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Content Cycle Intake — visible once cycle reaches requested state */}
      {channels.length > 0 && channels.some((ch) => {
        const s = cyclesByChannel.get(ch.channel)?.status;
        return s === 'requested' || s === 'reply_received' || s === 'awaiting_confirmation' || s === 'intake_confirmed';
      }) && (
        <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Content Cycle Intake</h2>
          <p className="text-xs text-gray-400 mb-5">
            Capture the client&apos;s planning input for this month. Three writers feed the same store:
            manual entry (here), email-reply capture (auto), voice note (magic link).
          </p>
          <div className="space-y-10">
            {channels.map((ch) => {
              const cycle = cyclesByChannel.get(ch.channel);
              const intakeStatuses = ['requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed'];
              if (!cycle || !intakeStatuses.includes(cycle.status)) return null;
              return (
                <div key={ch.channel}>
                  {channels.length > 1 && (
                    <p className="text-xs font-mono text-gray-500 mb-4">{ch.channel}</p>
                  )}
                  <IntakePanel
                    cycleId={cycle.id}
                    cycleMonth={dataMonth}
                    cycleStatus={cycle.status}
                    clientId={params.id}
                    channel={ch.channel}
                    questions={questionsForChannel(ch)}
                    existingIntake={cycle.intakeJson}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Prompt Coverage */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Prompt Templates</h2>
        <p className="text-xs text-gray-400 mb-4">
          Based on this client&apos;s active routing rules. Client-specific prompts override the shared default.
        </p>
        {promptCoverage.length === 0 ? (
          <p className="text-sm text-gray-400">No routing rules — no prompt steps to show.</p>
        ) : (
          <div className="space-y-6">
            {promptCoverage.map((wf) => (
              <div key={wf.workflowId}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                    {wf.workflowId}
                  </span>
                  {wf.missing && (
                    <span className="text-xs text-red-500 font-medium">workflow not registered</span>
                  )}
                </div>
                {!wf.missing && wf.steps.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-gray-500">
                        <th className="py-2 pr-6 font-medium">Step</th>
                        <th className="py-2 pr-6 font-medium">Model</th>
                        <th className="py-2 pr-6 font-medium">Status</th>
                        <th className="py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {wf.steps.map(({ step, clientSpecific, sharedDefault }) => {
                        const stepModels = config?.settings['stepModels'] as Record<string, Record<string, string>> | undefined;
                        const effectiveModel = stepModels?.[wf.workflowId]?.[step.stepName] ?? step.model;
                        const isOverridden = stepModels?.[wf.workflowId]?.[step.stepName] !== undefined;
                        return (
                        <tr key={step.stepName} className="border-b border-gray-50">
                          <td className="py-2 pr-6">
                            <span className="font-mono text-xs text-gray-900">{step.stepName}</span>
                            <span className="text-xs text-gray-400 ml-2">{step.stepDescription}</span>
                          </td>
                          <td className="py-2 pr-6">
                            <StepModelForm
                              clientId={params.id}
                              workflowId={wf.workflowId}
                              stepName={step.stepName}
                              currentModel={effectiveModel}
                              isOverridden={isOverridden}
                            />
                          </td>
                          <td className="py-2 pr-6">
                            {clientSpecific ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                                client v{clientSpecific.version}
                              </span>
                            ) : sharedDefault ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                shared default v{sharedDefault.version}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">
                                no prompt
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            {clientSpecific ? (
                              <Link
                                href={`/admin/prompts/${clientSpecific.id}`}
                                className="text-blue-600 hover:underline text-xs"
                              >
                                Edit →
                              </Link>
                            ) : (
                              <form action={customisePrompt}>
                                <input type="hidden" name="clientId" value={params.id} />
                                <input type="hidden" name="workflowId" value={wf.workflowId} />
                                <input type="hidden" name="stepName" value={step.stepName} />
                                <button
                                  type="submit"
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Customise →
                                </button>
                              </form>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {!wf.missing && wf.steps.length === 0 && (
                  <p className="text-xs text-gray-400">No prompt steps in this workflow.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">OAuth Connections</h2>
        {connections.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Scopes</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((conn) => (
                <tr key={conn.id} className="border-b border-gray-50">
                  <td className="py-2 pr-4 font-mono text-xs">{conn.provider}</td>
                  <td className="py-2 pr-4 text-gray-600">{conn.emailAddress ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        conn.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {conn.status}
                    </span>
                  </td>
                  <td className="py-2 text-xs text-gray-500">{conn.scopes.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">No OAuth connections.</p>
        )}
      </section>

      {/* Q&A Drafts — send-detection catches the Gmail-send path; this panel catches
          the in-panel path where a human approves text directly without sending from Gmail. */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Pending Q&A Drafts</h2>
        <p className="text-xs text-gray-400 mb-4">
          Drafts awaiting feedback. Paste the final sent text (or leave as-is) and click Approve to
          add it to the knowledge bank. If already sent from Gmail, this is handled automatically.
        </p>
        {pendingQaDrafts.length === 0 ? (
          <p className="text-sm text-gray-400">No pending Q&A drafts.</p>
        ) : (
          <div className="space-y-6">
            {pendingQaDrafts.map((draft) => (
              <div key={draft.id} className="border border-gray-100 rounded p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="text-sm">
                    {draft.cleanQuestion && (
                      <p className="font-medium text-gray-800">{draft.cleanQuestion}</p>
                    )}
                    <p className="text-gray-400 text-xs mt-0.5">
                      {formatDateTimeShort(draft.startedAt)} · run {draft.id.slice(0, 8)}
                    </p>
                  </div>
                </div>
                <form action={approveQaDraft} className="space-y-2">
                  <input type="hidden" name="runId" value={draft.id} />
                  <textarea
                    name="finalText"
                    defaultValue={draft.draftText ?? ''}
                    rows={6}
                    className="w-full text-sm border border-gray-200 rounded px-3 py-2 font-mono text-gray-800 resize-y"
                    placeholder="Paste the final sent text here…"
                  />
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Approve &amp; add to knowledge bank
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Events</h2>
        {events.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Received</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-b border-gray-50">
                  <td className="py-2 pr-4 font-mono text-xs">{ev.source}</td>
                  <td className="py-2 pr-4 text-gray-600">{ev.status}</td>
                  <td className="py-2 text-gray-500">{formatDateTimeShort(ev.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">No events yet.</p>
        )}
      </section>
    </div>
  );
}
