export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { db, clients, oauthConnections, triageConfigs } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';

async function getEligibleClients() {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      hasConfig: triageConfigs.id,
    })
    .from(clients)
    .innerJoin(
      oauthConnections,
      and(
        eq(oauthConnections.clientId, clients.id),
        eq(oauthConnections.provider, 'gmail'),
        eq(oauthConnections.status, 'active'),
      ),
    )
    .leftJoin(triageConfigs, eq(triageConfigs.clientId, clients.id))
    .orderBy(clients.name);

  // Deduplicate: a client with multiple connections appears once.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export default async function TriageConfigPage() {
  const rows = await getEligibleClients();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Triage Config</h1>
      <p className="text-sm text-gray-500 mb-6">
        Clients with an active Gmail connection. Configure categories, voice, and reply examples
        for the inbox triage workflow.
      </p>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Client</th>
              <th className="px-6 py-3 font-medium">Slug</th>
              <th className="px-6 py-3 font-medium">Config</th>
              <th className="px-6 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">{row.name}</td>
                <td className="px-6 py-3 text-gray-500 font-mono text-xs">{row.slug}</td>
                <td className="px-6 py-3">
                  {row.hasConfig !== null ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                      configured
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                      not set
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-right">
                  <Link
                    href={`/admin/triage-config/${row.id}`}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Configure →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                  No clients with an active Gmail connection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
