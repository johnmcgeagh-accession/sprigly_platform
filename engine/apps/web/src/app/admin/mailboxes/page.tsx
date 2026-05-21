export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { db, oauthConnections, clients } from '@sprigly/db';
import { eq, desc } from 'drizzle-orm';

function formatRelativeTime(date: Date): string {
  const diffMs  = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr} hr ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

async function getMailboxes() {
  return db
    .select({
      id:           oauthConnections.id,
      provider:     oauthConnections.provider,
      emailAddress: oauthConnections.emailAddress,
      status:       oauthConnections.status,
      pollingMode:  oauthConnections.pollingMode,
      lastPolledAt: oauthConnections.lastPolledAt,
      clientName:   clients.name,
      clientId:     clients.id,
    })
    .from(oauthConnections)
    .innerJoin(clients, eq(oauthConnections.clientId, clients.id))
    .orderBy(clients.name, desc(oauthConnections.createdAt));
}

export default async function MailboxesPage() {
  const mailboxes = await getMailboxes();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Mailboxes</h1>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Client</th>
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Provider</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Mode</th>
              <th className="px-6 py-3 font-medium">Last polled</th>
              <th className="px-6 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {mailboxes.map((m) => (
              <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-6 py-3">
                  <Link
                    href={`/admin/clients/${m.clientId}`}
                    className="text-gray-900 hover:underline"
                  >
                    {m.clientName}
                  </Link>
                </td>
                <td className="px-6 py-3 text-gray-600">{m.emailAddress ?? '—'}</td>
                <td className="px-6 py-3">
                  <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                    {m.provider}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    m.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {m.status}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    m.pollingMode === 'full'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {m.pollingMode}
                  </span>
                </td>
                <td className="px-6 py-3 text-gray-500">
                  {m.lastPolledAt
                    ? formatRelativeTime(m.lastPolledAt)
                    : '—'}
                </td>
                <td className="px-6 py-3 text-right">
                  <Link
                    href={`/admin/mailboxes/${m.id}`}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Change mode →
                  </Link>
                </td>
              </tr>
            ))}
            {mailboxes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                  No mailboxes connected.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
