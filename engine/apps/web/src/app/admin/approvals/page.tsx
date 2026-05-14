export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { db, approvals, workflowRuns, clients } from '@sprigly/db';
import { eq, desc } from 'drizzle-orm';
import { approveRun, rejectRun } from './actions';

async function getPendingApprovals() {
  return db
    .select({
      approvalId: approvals.id,
      status: approvals.status,
      outputSnapshot: approvals.outputSnapshot,
      createdAt: approvals.createdAt,
      workflowRunId: approvals.workflowRunId,
      workflowId: workflowRuns.workflowId,
      runStatus: workflowRuns.status,
      clientName: clients.name,
    })
    .from(approvals)
    .innerJoin(workflowRuns, eq(approvals.workflowRunId, workflowRuns.id))
    .innerJoin(clients, eq(workflowRuns.clientId, clients.id))
    .where(eq(approvals.status, 'pending'))
    .orderBy(desc(approvals.createdAt));
}

export default async function ApprovalsPage() {
  const pending = await getPendingApprovals();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Approvals</h1>

      {pending.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-12 text-center">
          <p className="text-gray-400">No pending approvals.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((row) => (
            <div key={row.approvalId} className="bg-white rounded-lg border border-gray-200 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">{row.clientName}</span>
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                      {row.workflowId}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      {row.runStatus}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    Received {row.createdAt.toLocaleString('en-GB')}
                  </p>
                  <pre className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded p-3 overflow-auto max-h-32 whitespace-pre-wrap font-mono leading-relaxed">
                    {JSON.stringify(row.outputSnapshot, null, 2)}
                  </pre>
                </div>
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <form action={approveRun}>
                    <input type="hidden" name="approvalId" value={row.approvalId} />
                    <button
                      type="submit"
                      className="w-full px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={rejectRun}>
                    <input type="hidden" name="approvalId" value={row.approvalId} />
                    <button
                      type="submit"
                      className="w-full px-4 py-2 rounded-md border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
