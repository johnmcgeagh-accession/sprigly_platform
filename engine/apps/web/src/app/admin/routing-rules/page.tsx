import Link from 'next/link';
import { db, routingRules, clients } from '@sprigly/db';
import { eq, desc } from 'drizzle-orm';

async function getRoutingRules() {
  return db
    .select({
      id: routingRules.id,
      source: routingRules.source,
      workflowId: routingRules.workflowId,
      enabled: routingRules.enabled,
      priority: routingRules.priority,
      matchConditions: routingRules.matchConditions,
      destinations: routingRules.destinations,
      clientName: clients.name,
    })
    .from(routingRules)
    .innerJoin(clients, eq(routingRules.clientId, clients.id))
    .orderBy(desc(routingRules.priority));
}

export default async function RoutingRulesPage() {
  const rules = await getRoutingRules();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Routing Rules</h1>
        <Link
          href="/admin/routing-rules/new"
          className="inline-flex items-center px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700"
        >
          New rule
        </Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Client</th>
              <th className="px-6 py-3 font-medium">Source</th>
              <th className="px-6 py-3 font-medium">Workflow</th>
              <th className="px-6 py-3 font-medium">Conditions</th>
              <th className="px-6 py-3 font-medium">Destination</th>
              <th className="px-6 py-3 font-medium">Priority</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const hasOverride = (rule.destinations as unknown[]).length > 0;
              return (
              <tr key={rule.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-6 py-3 text-gray-900">{rule.clientName}</td>
                <td className="px-6 py-3">
                  <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                    {rule.source}
                  </span>
                </td>
                <td className="px-6 py-3 text-gray-600 font-mono text-xs">{rule.workflowId}</td>
                <td className="px-6 py-3 text-gray-500">
                  {(rule.matchConditions as unknown[]).length} condition
                  {(rule.matchConditions as unknown[]).length !== 1 ? 's' : ''}
                </td>
                <td className="px-6 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    hasOverride ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {hasOverride ? 'override' : 'default'}
                  </span>
                </td>
                <td className="px-6 py-3 text-gray-500">{rule.priority}</td>
                <td className="px-6 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      rule.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {rule.enabled ? 'enabled' : 'disabled'}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <Link
                    href={`/admin/routing-rules/${rule.id}`}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    View →
                  </Link>
                </td>
              </tr>
              );
            })}
            {rules.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-gray-400">
                  No routing rules yet.{' '}
                  <Link href="/admin/routing-rules/new" className="text-blue-600 hover:underline">Create one.</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
