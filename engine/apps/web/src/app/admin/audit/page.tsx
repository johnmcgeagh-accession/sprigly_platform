import { db, auditLog, clients } from '@sprigly/db';
import { eq, desc } from 'drizzle-orm';

function formatCost(costPence: number | null): string {
  if (costPence == null) return '—';
  return `£${(costPence / 100).toFixed(2)}`;
}

async function getAuditLog() {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      modelId: auditLog.modelId,
      inputTokens: auditLog.inputTokens,
      outputTokens: auditLog.outputTokens,
      costPence: auditLog.costPence,
      createdAt: auditLog.createdAt,
      clientName: clients.name,
    })
    .from(auditLog)
    .innerJoin(clients, eq(auditLog.clientId, clients.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(100);
}

export default async function AuditPage() {
  const entries = await getAuditLog();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Audit Log</h1>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Action</th>
              <th className="px-6 py-3 font-medium">Model</th>
              <th className="px-6 py-3 font-medium text-right">Tokens in</th>
              <th className="px-6 py-3 font-medium text-right">Tokens out</th>
              <th className="px-6 py-3 font-medium text-right">Cost</th>
              <th className="px-6 py-3 font-medium">Client</th>
              <th className="px-6 py-3 font-medium">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-6 py-3 font-mono text-xs text-gray-700">{entry.action}</td>
                <td className="px-6 py-3 font-mono text-xs text-gray-500">
                  {entry.modelId ?? '—'}
                </td>
                <td className="px-6 py-3 text-gray-500 text-right tabular-nums">
                  {entry.inputTokens?.toLocaleString() ?? '—'}
                </td>
                <td className="px-6 py-3 text-gray-500 text-right tabular-nums">
                  {entry.outputTokens?.toLocaleString() ?? '—'}
                </td>
                <td className="px-6 py-3 text-gray-700 text-right tabular-nums font-medium">
                  {formatCost(entry.costPence)}
                </td>
                <td className="px-6 py-3 text-gray-600">{entry.clientName}</td>
                <td className="px-6 py-3 text-gray-400 text-xs">
                  {entry.createdAt.toLocaleString('en-GB')}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
