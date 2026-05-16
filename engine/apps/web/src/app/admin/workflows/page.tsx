import Link from 'next/link';
import { workflowMeta, type WorkflowMeta } from '@sprigly/workflows';

export default function WorkflowsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Workflows</h1>
      <p className="text-sm text-gray-500 mb-6">
        Workflows are defined in code. This view is read-only.
      </p>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">ID</th>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Default destination</th>
              <th className="px-6 py-3 font-medium">Steps</th>
              <th className="px-6 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {workflowMeta.map((w: WorkflowMeta) => (
              <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-6 py-3 font-mono text-xs text-gray-700">{w.id}</td>
                <td className="px-6 py-3 text-gray-900 font-medium">{w.name}</td>
                <td className="px-6 py-3 font-mono text-xs text-gray-500">
                  {w.defaultDestinations.map(d => d.destinationId).join(', ')}
                </td>
                <td className="px-6 py-3 text-gray-500">{w.steps.length}</td>
                <td className="px-6 py-3 text-right">
                  <Link
                    href={`/admin/workflows/${w.id}`}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
            {workflowMeta.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                  No workflows registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
