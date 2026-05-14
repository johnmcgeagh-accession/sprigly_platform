export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { db, incomingEvents, clients } from '@sprigly/db';
import { eq, desc } from 'drizzle-orm';

const statusColours: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  running: 'bg-blue-100 text-blue-700',
};

async function getEvents() {
  return db
    .select({
      id: incomingEvents.id,
      source: incomingEvents.source,
      status: incomingEvents.status,
      receivedAt: incomingEvents.receivedAt,
      externalId: incomingEvents.externalId,
      clientName: clients.name,
    })
    .from(incomingEvents)
    .innerJoin(clients, eq(incomingEvents.clientId, clients.id))
    .orderBy(desc(incomingEvents.receivedAt))
    .limit(50);
}

export default async function EventsPage() {
  const events = await getEvents();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Events</h1>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Client</th>
              <th className="px-6 py-3 font-medium">Source</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Received</th>
              <th className="px-6 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => {
              const cls = statusColours[ev.status] ?? 'bg-gray-100 text-gray-600';
              return (
                <tr key={ev.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-900">{ev.clientName}</td>
                  <td className="px-6 py-3">
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                      {ev.source}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
                      {ev.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-500">
                    {ev.receivedAt.toLocaleString('en-GB')}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link
                      href={`/admin/events/${ev.id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                  No events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-gray-400 mt-3">
        Only events that matched a routing rule are shown. Emails received without a matching rule are not persisted.
      </p>
    </div>
  );
}
