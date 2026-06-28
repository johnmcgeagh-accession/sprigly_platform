export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { formatDateTimeShort } from '@/lib/format-date';

import { db, gmailOperationErrors, clients } from '@sprigly/db';
import { eq, and, desc, gt, sql } from 'drizzle-orm';
import { resolveError } from './actions';

type SearchParams = { clientId?: string; operation?: string };

async function getUnresolvedCount24h(): Promise<number> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(gmailOperationErrors)
    .where(and(
      eq(gmailOperationErrors.resolved, false),
      gt(gmailOperationErrors.createdAt, twentyFourHoursAgo),
    ));
  return rows[0]?.count ?? 0;
}

async function getErrors(filters: SearchParams) {
  const conditions = [eq(gmailOperationErrors.resolved, false)];
  if (filters.clientId) conditions.push(eq(gmailOperationErrors.clientId, filters.clientId));
  if (filters.operation) conditions.push(eq(gmailOperationErrors.operation, filters.operation));

  return db
    .select({
      id:           gmailOperationErrors.id,
      createdAt:    gmailOperationErrors.createdAt,
      operation:    gmailOperationErrors.operation,
      externalId:   gmailOperationErrors.externalId,
      errorCode:    gmailOperationErrors.errorCode,
      errorMessage: gmailOperationErrors.errorMessage,
      clientName:   clients.name,
      clientId:     gmailOperationErrors.clientId,
    })
    .from(gmailOperationErrors)
    .innerJoin(clients, eq(gmailOperationErrors.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(desc(gmailOperationErrors.createdAt))
    .limit(200);
}

async function getClientList() {
  return db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(clients.name);
}

const KNOWN_OPERATIONS = ['markAsRead', 'createDraft', 'sendMessage'];

export default async function GmailErrorsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [unresolvedCount, errors, clientList] = await Promise.all([
    getUnresolvedCount24h(),
    getErrors(searchParams),
    getClientList(),
  ]);

  const filterUrl = (overrides: SearchParams) => {
    const params = new URLSearchParams();
    const merged = { ...searchParams, ...overrides };
    if (merged.clientId) params.set('clientId', merged.clientId);
    if (merged.operation) params.set('operation', merged.operation);
    return `/admin/gmail-errors?${params.toString()}`;
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Gmail Errors</h1>

      <div className={`rounded-lg border px-6 py-5 mb-6 inline-block ${unresolvedCount > 0 ? 'bg-red-50 border-red-300' : 'bg-white border-gray-200'}`}>
        <p className="text-sm text-gray-500 mb-1">Unresolved (last 24h)</p>
        <p className={`text-4xl font-bold ${unresolvedCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
          {unresolvedCount}
        </p>
      </div>

      <div className="flex gap-4 mb-6">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Client</label>
          <select
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 bg-white"
            defaultValue={searchParams.clientId ?? ''}
            onChange={undefined}
            name="clientId"
            form="filter-form"
          >
            <option value="">All clients</option>
            {clientList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Operation</label>
          <select
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 bg-white"
            defaultValue={searchParams.operation ?? ''}
            name="operation"
            form="filter-form"
          >
            <option value="">All operations</option>
            {KNOWN_OPERATIONS.map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
        </div>
        <form id="filter-form" method="get" action="/admin/gmail-errors" className="flex items-end">
          <button
            type="submit"
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50"
          >
            Filter
          </button>
        </form>
        {(searchParams.clientId || searchParams.operation) && (
          <div className="flex items-end">
            <a
              href="/admin/gmail-errors"
              className="px-3 py-1.5 text-sm rounded-md text-gray-500 hover:text-gray-900"
            >
              Clear
            </a>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Operation</th>
              <th className="px-4 py-3 font-medium">Message ID</th>
              <th className="px-4 py-3 font-medium">Error</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {errors.map((row) => (
              <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                  {formatDateTimeShort(row.createdAt)}
                </td>
                <td className="px-4 py-3 text-gray-900">{row.clientName}</td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                    {row.operation}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500 max-w-[160px] truncate">
                  {row.externalId ?? '—'}
                </td>
                <td className="px-4 py-3 text-gray-600 max-w-[320px]">
                  {row.errorCode && (
                    <span className="font-mono text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded mr-2">
                      {row.errorCode}
                    </span>
                  )}
                  <span className="text-xs">{row.errorMessage}</span>
                </td>
                <td className="px-4 py-3">
                  <form action={resolveError}>
                    <input type="hidden" name="errorId" value={row.id} />
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-md border border-gray-200 text-xs text-gray-600 hover:bg-gray-100"
                    >
                      Resolve
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {errors.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  No unresolved Gmail errors.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
