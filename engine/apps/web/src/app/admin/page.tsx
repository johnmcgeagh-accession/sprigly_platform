export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { db, clients, incomingEvents, workflowRuns, approvals, gmailOperationErrors } from '@sprigly/db';
import { eq, gt, and, desc, sql } from 'drizzle-orm';

async function getStats() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [clientCount, eventCount, approvalCount, gmailErrorCount] = await Promise.all([
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(clients)
      .where(eq(clients.status, 'active')),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(incomingEvents)
      .where(gt(incomingEvents.receivedAt, twentyFourHoursAgo)),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(approvals)
      .where(eq(approvals.status, 'pending')),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(gmailOperationErrors)
      .where(and(
        eq(gmailOperationErrors.resolved, false),
        gt(gmailOperationErrors.createdAt, twentyFourHoursAgo),
      )),
  ]);

  return {
    clients: clientCount[0]?.count ?? 0,
    eventsLast24h: eventCount[0]?.count ?? 0,
    pendingApprovals: approvalCount[0]?.count ?? 0,
    gmailErrors24h: gmailErrorCount[0]?.count ?? 0,
  };
}

async function getRecentRuns() {
  return db
    .select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      clientName: clients.name,
    })
    .from(workflowRuns)
    .innerJoin(clients, eq(workflowRuns.clientId, clients.id))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(10);
}

export default async function DashboardPage() {
  const [stats, recentRuns] = await Promise.all([getStats(), getRecentRuns()]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-4 gap-6 mb-8">
        <StatCard label="Active Clients" value={stats.clients} />
        <StatCard label="Events (24h)" value={stats.eventsLast24h} />
        <StatCard label="Pending Approvals" value={stats.pendingApprovals} />
        <StatCard label="Gmail Errors (24h)" value={stats.gmailErrors24h} alert={stats.gmailErrors24h > 0} />
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Recent Workflow Runs</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Client</th>
              <th className="px-6 py-3 font-medium">Workflow</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.map((run) => (
              <tr key={run.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-6 py-3 text-gray-900">{run.clientName}</td>
                <td className="px-6 py-3 text-gray-600">{run.workflowId}</td>
                <td className="px-6 py-3">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-6 py-3 text-gray-500">
                  {run.startedAt.toLocaleString('en-GB')}
                </td>
              </tr>
            ))}
            {recentRuns.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                  No workflow runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`bg-white rounded-lg border px-6 py-5 ${alert ? 'border-red-300' : 'border-gray-200'}`}>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${alert ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    running: 'bg-blue-100 text-blue-700',
  };
  const cls = colours[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
