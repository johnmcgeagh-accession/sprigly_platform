import Link from 'next/link';
import { db, clients } from '@sprigly/db';
import { workflowMeta, type WorkflowMeta } from '@sprigly/workflows';
import { createRoutingRule } from '../actions';
import { DestinationOverride } from './destination-override';

const DEFAULT_CONDITIONS = JSON.stringify(
  [{ field: 'subject', op: 'startsWith', value: 'Brief:', caseSensitive: false }],
  null,
  2,
);

async function getClients() {
  return db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(clients.name);
}

export default async function NewRoutingRulePage() {
  const allClients = await getClients();

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/routing-rules" className="text-sm text-gray-500 hover:text-gray-700">
          ← Routing Rules
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">New Routing Rule</h1>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 px-6 py-6 max-w-2xl">
        <form action={createRoutingRule} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="clientId">
              Client
            </label>
            <select
              id="clientId"
              name="clientId"
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {allClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="source">
              Source
            </label>
            <select
              id="source"
              name="source"
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="email">email</option>
              <option value="webhook">webhook</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="workflowId">
              Workflow
            </label>
            <select
              id="workflowId"
              name="workflowId"
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {workflowMeta.map((w: WorkflowMeta) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-gray-700 mb-1"
              htmlFor="matchConditionsJson"
            >
              Trigger conditions <span className="text-gray-400 font-normal">(JSON array)</span>
            </label>
            <textarea
              id="matchConditionsJson"
              name="matchConditionsJson"
              rows={5}
              required
              defaultValue={DEFAULT_CONDITIONS}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <DestinationOverride />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="priority">
                Priority
              </label>
              <input
                id="priority"
                name="priority"
                type="number"
                defaultValue={10}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked
                  className="w-4 h-4 rounded border-gray-300"
                />
                Enabled
              </label>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="px-6 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700"
            >
              Create rule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
