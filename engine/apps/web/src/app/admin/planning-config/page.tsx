export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { db, clients, clientChannels, clientPlanningConfig } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';

async function getChannelRows() {
  const rows = await db
    .select({
      clientId:  clients.id,
      name:      clients.name,
      slug:      clients.slug,
      channel:   clientChannels.channel,
      configId:  clientPlanningConfig.id,
    })
    .from(clients)
    .innerJoin(clientChannels, eq(clientChannels.clientId, clients.id))
    .leftJoin(
      clientPlanningConfig,
      and(
        eq(clientPlanningConfig.clientId, clients.id),
        eq(clientPlanningConfig.channel, clientChannels.channel),
      ),
    )
    .orderBy(clients.name, clientChannels.channel);

  return rows;
}

export default async function PlanningConfigPage() {
  const rows = await getChannelRows();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Planning Config</h1>
      <p className="text-sm text-gray-500 mb-6">
        Per-channel content planning configuration: pillars, competitors, cadence, recurring series,
        posting times, and category vocabulary.
      </p>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Client</th>
              <th className="px-6 py-3 font-medium">Channel</th>
              <th className="px-6 py-3 font-medium">Config</th>
              <th className="px-6 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.clientId}-${row.channel}`}
                className="border-b border-gray-50 hover:bg-gray-50"
              >
                <td className="px-6 py-3 font-medium text-gray-900">{row.name}</td>
                <td className="px-6 py-3 text-gray-500 font-mono text-xs">{row.channel}</td>
                <td className="px-6 py-3">
                  {row.configId !== null ? (
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
                    href={`/admin/planning-config/${row.clientId}/${row.channel}`}
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
                  No client channels configured. Add channels in the Clients section first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
