export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Narrow action surface: this page exposes only what's needed to act on
// triage suggestions (subject, from, draft text, escalation reason).
// No tenant settings, no account data, no cross-tenant items.
// The token in the URL PATH is the sole auth mechanism.

import { notFound } from 'next/navigation';
import { db, triageDigestTokens, triageCaptureLog, incomingEvents } from '@sprigly/db';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { ReviewClient } from './review-client';
import type { ReviewItem } from './review-client';

async function resolveTokenToClient(token: string): Promise<string | null> {
  const rows = await db
    .select({ clientId: triageDigestTokens.clientId })
    .from(triageDigestTokens)
    .where(and(eq(triageDigestTokens.token, token), gt(triageDigestTokens.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.clientId ?? null;
}

async function getPendingItems(clientId: string): Promise<ReviewItem[]> {
  // All queries filter by clientId derived from the token — no cross-tenant
  // data can be returned regardless of what other values are in the DB.
  const rows = await db
    .select({
      captureLogId:     triageCaptureLog.id,
      category:         triageCaptureLog.category,
      suggestedAction:  triageCaptureLog.suggestedAction,
      draftText:        triageCaptureLog.draftText,
      escalationReason: triageCaptureLog.escalationReason,
      sourceMetadata:   incomingEvents.sourceMetadata,
    })
    .from(triageCaptureLog)
    .innerJoin(incomingEvents, eq(incomingEvents.id, triageCaptureLog.eventId))
    .where(
      and(
        eq(triageCaptureLog.clientId, clientId),
        isNull(triageCaptureLog.decision),
      ),
    );

  return rows.map((row) => {
    const meta = row.sourceMetadata as Record<string, unknown>;
    return {
      captureLogId:     row.captureLogId,
      category:         row.category,
      suggestedAction:  row.suggestedAction,
      subject:          typeof meta['subject'] === 'string' ? meta['subject'] : '(no subject)',
      from:             typeof meta['from'] === 'string' ? meta['from'] : '(unknown sender)',
      draftText:        row.draftText ?? null,
      escalationReason: row.escalationReason ?? null,
    };
  });
}

export default async function ReviewPage({ params }: { params: { token: string } }) {
  const clientId = await resolveTokenToClient(params.token);
  if (clientId === null) notFound();

  const items = await getPendingItems(clientId);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-10 px-4">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Inbox review</h1>
          {items.length > 0 ? (
            <p className="text-sm text-gray-500 mt-1">
              {items.length} {items.length === 1 ? 'item' : 'items'} awaiting your decision.
            </p>
          ) : (
            <p className="text-sm text-gray-500 mt-1">Nothing left to review.</p>
          )}
        </div>

        <ReviewClient token={params.token} items={items} />
      </div>
    </div>
  );
}
