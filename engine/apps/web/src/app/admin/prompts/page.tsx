import Link from 'next/link';
import { db, promptTemplates, clients } from '@sprigly/db';
import { eq, desc } from 'drizzle-orm';

async function getLatestTemplates() {
  const all = await db
    .select({
      id: promptTemplates.id,
      clientId: promptTemplates.clientId,
      workflowId: promptTemplates.workflowId,
      stepName: promptTemplates.stepName,
      version: promptTemplates.version,
      clientName: clients.name,
    })
    .from(promptTemplates)
    .leftJoin(clients, eq(promptTemplates.clientId, clients.id))
    .orderBy(promptTemplates.workflowId, promptTemplates.stepName, desc(promptTemplates.version));

  const seen = new Set<string>();
  const latest = all.filter((t) => {
    const key = `${t.clientId ?? 'global'}-${t.workflowId}-${t.stepName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const grouped = latest.reduce<Record<string, typeof latest>>((acc, t) => {
    (acc[t.workflowId] ??= []).push(t);
    return acc;
  }, {});

  return grouped;
}

export default async function PromptsPage() {
  const grouped = await getLatestTemplates();
  const workflowIds = Object.keys(grouped).sort();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Prompt Templates</h1>

      {workflowIds.length === 0 && (
        <p className="text-gray-400">No prompt templates yet.</p>
      )}

      <div className="space-y-8">
        {workflowIds.map((workflowId) => {
          const templates = grouped[workflowId] ?? [];
          return (
            <div key={workflowId}>
              <h2 className="text-sm font-medium text-gray-500 mb-3">
                <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                  {workflowId}
                </span>
              </h2>
              <div className="bg-white rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="px-6 py-3 font-medium">Step</th>
                      <th className="px-6 py-3 font-medium">Version</th>
                      <th className="px-6 py-3 font-medium">Client</th>
                      <th className="px-6 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t) => (
                      <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-6 py-3 font-mono text-sm text-gray-900">{t.stepName}</td>
                        <td className="px-6 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            v{t.version}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-gray-500">{t.clientName ?? 'global'}</td>
                        <td className="px-6 py-3 text-right">
                          <Link
                            href={`/admin/prompts/${t.id}`}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
