export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, clients, clientConfigs, oauthConnections, incomingEvents, routingRules, promptTemplates, workflowRuns } from '@sprigly/db';
import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import { workflowMeta, type WorkflowMeta } from '@sprigly/workflows';
import { customisePrompt, approveQaDraft } from './actions';
import { StepModelForm } from './StepModelForm';

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
  const [client, config, connections, events, clientRules, pendingQaDrafts] = await Promise.all([
    getClient(params.id),
    getClientConfig(params.id),
    getOAuthConnections(params.id),
    getRecentEvents(params.id),
    getClientRoutingRules(params.id),
    getPendingQaDrafts(params.id),
  ]);

  if (!client) notFound();

  const workflowIds = clientRules.map((r) => r.workflowId);
  const promptCoverage = await getPromptCoverage(params.id, workflowIds);

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
                      {draft.startedAt.toLocaleString('en-GB')} · run {draft.id.slice(0, 8)}
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
                  <td className="py-2 text-gray-500">{ev.receivedAt.toLocaleString('en-GB')}</td>
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
