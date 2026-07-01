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
      lastOkAt:     oauthConnections.lastOkAt,
      lastError:    oauthConnections.lastError,
      lastErrorAt:  oauthConnections.lastErrorAt,
      clientName:   clients.name,
      clientId:     clients.id,
    })
    .from(oauthConnections)
    .innerJoin(clients, eq(oauthConnections.clientId, clients.id))
    .orderBy(clients.name, desc(oauthConnections.createdAt));
}

function healthLabel(status: string): { text: string; cls: string } {
  if (status === 'active') return { text: 'connected',       cls: 'bg-green-100 text-green-700' };
  if (status === 'error')  return { text: 'needs reconnect', cls: 'bg-red-100 text-red-700' };
  return { text: status, cls: 'bg-gray-100 text-gray-600' };
}

export default async function MailboxesPage({ searchParams }: { searchParams: { oauth_connected?: string; oauth_error?: string } }) {
  const mailboxes = await getMailboxes();
  const connected = searchParams.oauth_connected;
  const oauthError = searchParams.oauth_error;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Mailboxes &amp; OAuth connections</h1>

      {connected && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          ✓ Reconnected <span className="font-medium">{connected}</span>. Polling resumes automatically.
        </div>
      )}
      {oauthError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          Reconnect failed: <span className="font-mono text-xs">{oauthError}</span>
          {oauthError === 'no_refresh_token' && ' — revoke Sprigly\'s access in the Google account, then reconnect so a fresh refresh token is issued.'}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Client</th>
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Provider</th>
              <th className="px-6 py-3 font-medium">Health</th>
              <th className="px-6 py-3 font-medium">Mode</th>
              <th className="px-6 py-3 font-medium">Last polled</th>
              <th className="px-6 py-3 font-medium">Last OK</th>
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
                  {(() => { const h = healthLabel(m.status); return (
                    <span
                      title={m.status === 'error' && m.lastError ? `${m.lastError}${m.lastErrorAt ? ` (${formatRelativeTime(m.lastErrorAt)})` : ''}` : undefined}
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${h.cls}`}
                    >
                      {h.text}
                    </span>
                  ); })()}
                  {m.status === 'error' && m.lastError && (
                    <div className="mt-1 max-w-xs truncate text-[11px] text-red-500" title={m.lastError}>{m.lastError}</div>
                  )}
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
                <td className="px-6 py-3 text-gray-500">
                  {m.lastOkAt ? formatRelativeTime(m.lastOkAt) : '—'}
                </td>
                <td className="px-6 py-3 text-right whitespace-nowrap">
                  <a
                    href={`/api/oauth/${m.provider}/authorize?clientId=${m.clientId}`}
                    className={`text-xs font-medium ${m.status === 'error' ? 'text-red-600' : 'text-blue-600'} hover:underline`}
                  >
                    {m.status === 'error' ? 'Reconnect' : 'Connect / Reconnect'}
                  </a>
                  <Link
                    href={`/admin/mailboxes/${m.id}`}
                    className="ml-3 text-blue-600 hover:underline text-xs"
                  >
                    Mode →
                  </Link>
                </td>
              </tr>
            ))}
            {mailboxes.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-gray-400">
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
