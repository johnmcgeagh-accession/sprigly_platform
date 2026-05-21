export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, oauthConnections, clients } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { changeMailboxMode } from './actions';

async function getMailbox(id: string) {
  const rows = await db
    .select({
      id:           oauthConnections.id,
      clientId:     oauthConnections.clientId,
      provider:     oauthConnections.provider,
      emailAddress: oauthConnections.emailAddress,
      status:       oauthConnections.status,
      pollingMode:  oauthConnections.pollingMode,
      lastPolledAt: oauthConnections.lastPolledAt,
      clientName:   clients.name,
    })
    .from(oauthConnections)
    .innerJoin(clients, eq(oauthConnections.clientId, clients.id))
    .where(eq(oauthConnections.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export default async function MailboxModePage({ params }: { params: { id: string } }) {
  const mailbox = await getMailbox(params.id);
  if (!mailbox) notFound();

  const targetMode = mailbox.pollingMode === 'selective' ? 'full' : 'selective';
  const switchingToFull = targetMode === 'full';

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/admin/mailboxes" className="text-sm text-gray-500 hover:text-gray-700">
          ← Mailboxes
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Change polling mode</h1>
      <p className="text-sm text-gray-500 mb-8">
        {mailbox.emailAddress ?? mailbox.provider} · {mailbox.clientName}
      </p>

      <div className="bg-white rounded-lg border border-gray-200 px-6 py-5 mb-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">Current mode</dt>
            <dd className="mt-0.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                mailbox.pollingMode === 'full'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {mailbox.pollingMode}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Switch to</dt>
            <dd className="mt-0.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                switchingToFull
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {targetMode}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      {switchingToFull && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-4 mb-6">
          <p className="text-sm font-medium text-amber-800 mb-2">Before you switch to full mode</p>
          <p className="text-sm text-amber-700">
            Full mode processes <strong>every email</strong> in this mailbox and marks it as read.
            Until a triage workflow is configured, emails are handled by a confirmation step that
            records them but takes no action — no replies, no drafts.
          </p>
          <p className="text-sm text-amber-700 mt-2">
            Use full mode only for a mailbox <strong>dedicated to Sprigly</strong>, not a shared inbox.
            Switching will mark all future incoming emails as read, including emails unrelated to Sprigly workflows.
          </p>
        </div>
      )}

      <div className="flex items-center gap-4">
        <form action={changeMailboxMode}>
          <input type="hidden" name="connectionId" value={mailbox.id} />
          <input type="hidden" name="targetMode"   value={targetMode} />
          <button
            type="submit"
            className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white ${
              switchingToFull
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-gray-900 hover:bg-gray-700'
            }`}
          >
            {switchingToFull
              ? 'Confirm — switch to full mode'
              : 'Confirm — switch to selective mode'}
          </button>
        </form>
        <Link
          href="/admin/mailboxes"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
