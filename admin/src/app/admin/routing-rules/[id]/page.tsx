export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { formatDateTimeShort } from '@/lib/format-date';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, routingRules, clients } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { toggleEnabled, deleteRoutingRule } from '../actions';

type Condition = {
  field: string;
  op: string;
  value: string;
  caseSensitive?: boolean;
};

type Destination = {
  destinationId: string;
  requireApproval?: boolean;
  settings?: Record<string, unknown>;
};

async function getRule(id: string) {
  const rows = await db
    .select({
      id: routingRules.id,
      source: routingRules.source,
      workflowId: routingRules.workflowId,
      enabled: routingRules.enabled,
      priority: routingRules.priority,
      matchConditions: routingRules.matchConditions,
      destinations: routingRules.destinations,
      clientConfigId: routingRules.clientConfigId,
      isFallback: routingRules.isFallback,
      createdAt: routingRules.createdAt,
      clientName: clients.name,
      clientId: clients.id,
    })
    .from(routingRules)
    .innerJoin(clients, eq(routingRules.clientId, clients.id))
    .where(eq(routingRules.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export default async function RoutingRuleDetailPage({ params }: { params: { id: string } }) {
  const rule = await getRule(params.id);
  if (!rule) notFound();

  const conditions = rule.matchConditions as Condition[];
  const destinations = rule.destinations as Destination[];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin/routing-rules" className="text-sm text-gray-500 hover:text-gray-700">
            ← Routing Rules
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{rule.workflowId}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Client: <span className="font-medium text-gray-700">{rule.clientName}</span>
            {' · '}
            Source:{' '}
            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
              {rule.source}
            </span>
            {' · '}
            Priority: {rule.priority}
          </p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded text-sm font-medium ${
            rule.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {rule.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {/* Match Conditions */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold text-gray-900">Match Conditions</h2>
          {conditions.length === 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
              Match all
            </span>
          )}
          {rule.isFallback && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
              Fallback
            </span>
          )}
        </div>
        {conditions.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="py-2 pr-6 font-medium">Field</th>
                <th className="py-2 pr-6 font-medium">Operator</th>
                <th className="py-2 pr-6 font-medium">Value</th>
                <th className="py-2 font-medium">Case sensitive</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((c, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 pr-6 font-mono text-xs text-gray-700">{c.field}</td>
                  <td className="py-2 pr-6 font-mono text-xs text-gray-700">{c.op}</td>
                  <td className="py-2 pr-6 font-mono text-xs text-gray-900">{c.value}</td>
                  <td className="py-2 text-gray-500 text-xs">
                    {c.caseSensitive === true ? 'yes' : 'no'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">No conditions — matches all.</p>
        )}
      </section>

      {/* Destinations */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Destination</h2>
        {destinations.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-amber-600 font-medium mb-2">Override — workflow default not used</p>
            {destinations.map((d, i) => (
              <div key={i} className="border border-gray-100 rounded-md px-4 py-3">
                <p className="font-mono text-sm text-gray-900">{d.destinationId}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Requires approval: {d.requireApproval === true ? 'yes' : 'no'}
                </p>
                {d.settings && Object.keys(d.settings).length > 0 && (
                  <pre className="text-xs text-gray-500 mt-2 bg-gray-50 rounded p-2 overflow-auto">
                    {JSON.stringify(d.settings, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Using workflow default.{' '}
            <span className="text-gray-400">
              The workflow declares its own destination — no override configured for this rule.
            </span>
          </p>
        )}
      </section>

      {/* Actions */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Actions</h2>
        <div className="flex gap-3">
          <form action={toggleEnabled}>
            <input type="hidden" name="id" value={rule.id} />
            <input type="hidden" name="enabled" value={String(!rule.enabled)} />
            <button
              type="submit"
              className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              {rule.enabled ? 'Disable' : 'Enable'}
            </button>
          </form>
          <form action={deleteRoutingRule}>
            <input type="hidden" name="id" value={rule.id} />
            <button
              type="submit"
              className="px-4 py-2 rounded-md border border-red-200 text-sm text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </form>
        </div>
      </section>

      <div className="text-xs text-gray-400">
        Created: {formatDateTimeShort(rule.createdAt)}
        {rule.clientConfigId && (
          <span className="ml-4">Config ID: <span className="font-mono">{rule.clientConfigId}</span></span>
        )}
      </div>
    </div>
  );
}
