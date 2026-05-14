export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, incomingEvents, workflowRuns, clients } from '@sprigly/db';
import { eq, desc } from 'drizzle-orm';

const statusColours: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  running: 'bg-blue-100 text-blue-700',
};

async function getEvent(id: string) {
  const rows = await db
    .select({
      id: incomingEvents.id,
      source: incomingEvents.source,
      status: incomingEvents.status,
      receivedAt: incomingEvents.receivedAt,
      externalId: incomingEvents.externalId,
      content: incomingEvents.content,
      sourceMetadata: incomingEvents.sourceMetadata,
      clientName: clients.name,
    })
    .from(incomingEvents)
    .innerJoin(clients, eq(incomingEvents.clientId, clients.id))
    .where(eq(incomingEvents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function getLinkedRuns(eventId: string) {
  return db
    .select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      endedAt: workflowRuns.endedAt,
      error: workflowRuns.error,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.eventId, eventId))
    .orderBy(desc(workflowRuns.startedAt));
}

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const [event, runs] = await Promise.all([getEvent(params.id), getLinkedRuns(params.id)]);
  if (!event) notFound();

  const hasSourceMetadata = Object.keys(event.sourceMetadata).length > 0;
  const statusCls = statusColours[event.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/events" className="text-sm text-gray-500 hover:text-gray-700">
          ← Events
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-bold text-gray-900">
            <span className="font-mono">{event.source}</span> event
          </h1>
          <span className={`inline-flex items-center px-2.5 py-1 rounded text-sm font-medium ${statusCls}`}>
            {event.status}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Client: <span className="font-medium text-gray-700">{event.clientName}</span>
          {' · '}
          Received: {event.receivedAt.toLocaleString('en-GB')}
          {event.externalId && (
            <span className="ml-4 font-mono text-xs">{event.externalId}</span>
          )}
        </p>
      </div>

      {/* Content */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Content</h2>
        <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded p-4 overflow-auto max-h-48 whitespace-pre-wrap font-mono leading-relaxed">
          {JSON.stringify(event.content, null, 2)}
        </pre>
      </section>

      {/* Source metadata (only if non-empty) */}
      {hasSourceMetadata && (
        <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Source metadata</h2>
          <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded p-4 overflow-auto max-h-48 whitespace-pre-wrap font-mono leading-relaxed">
            {JSON.stringify(event.sourceMetadata, null, 2)}
          </pre>
        </section>
      )}

      {/* Workflow runs */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Workflow runs</h2>
        {runs.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="py-2 pr-6 font-medium">Workflow</th>
                <th className="py-2 pr-6 font-medium">Status</th>
                <th className="py-2 pr-6 font-medium">Started</th>
                <th className="py-2 font-medium">Ended</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const cls = statusColours[run.status] ?? 'bg-gray-100 text-gray-600';
                return (
                  <tr key={run.id} className="border-b border-gray-50">
                    <td className="py-2 pr-6 font-mono text-xs text-gray-700">{run.workflowId}</td>
                    <td className="py-2 pr-6">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2 pr-6 text-gray-500 text-xs">
                      {run.startedAt.toLocaleString('en-GB')}
                    </td>
                    <td className="py-2 text-gray-500 text-xs">
                      {run.endedAt ? run.endedAt.toLocaleString('en-GB') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">No workflow runs linked to this event.</p>
        )}
      </section>
    </div>
  );
}
