'use server';

// This action surface is narrow by design: approve/modify/reject only.
// It exposes nothing about the tenant beyond what's needed to act on a
// triage suggestion. Token is re-validated on every action — not just
// on page load — so a leaked or expired token cannot submit.

import { db, triageDigestTokens, triageCaptureLog, incomingEvents, oauthConnections } from '@sprigly/db';
import { eq, and, gt } from 'drizzle-orm';
import { recordResolution } from '@sprigly/engine';
import { createGmailReadStateService, createGmailDraftService } from '@sprigly/sources';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { revalidatePath } from 'next/cache';
import { Queue } from 'bullmq';

async function resolveToken(token: string): Promise<string | null> {
  const rows = await db
    .select({ clientId: triageDigestTokens.clientId })
    .from(triageDigestTokens)
    .where(and(eq(triageDigestTokens.token, token), gt(triageDigestTokens.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.clientId ?? null;
}

async function makeMark(): Promise<(clientId: string, externalId: string) => Promise<void>> {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    console.error(
      '[triage-review] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing from process.env — markRead skipped. ' +
      `GOOGLE_CLIENT_ID present: ${!!googleClientId}, GOOGLE_CLIENT_SECRET present: ${!!googleClientSecret}`,
    );
    return async () => {};
  }
  const encProvider = createEncryptionProvider();
  const svc = createGmailReadStateService(db, encProvider, googleClientId, googleClientSecret);
  return (clientId: string, externalId: string) => svc.markRead(clientId, externalId);
}

function makeDraftService() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) return null;
  const encProvider = createEncryptionProvider();
  return createGmailDraftService(db, encProvider, googleClientId, googleClientSecret);
}

async function getOriginals(captureLogId: string, clientId: string) {
  const rows = await db
    .select({
      suggestedAction: triageCaptureLog.suggestedAction,
      draftText:       triageCaptureLog.draftText,
      gmailDraftId:    triageCaptureLog.gmailDraftId,
      eventId:         triageCaptureLog.eventId,
    })
    .from(triageCaptureLog)
    .where(
      and(
        eq(triageCaptureLog.id, captureLogId),
        eq(triageCaptureLog.clientId, clientId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getEventMeta(eventId: string): Promise<{ from: string; subject: string; rfcMessageId?: string; threadId: string; bodyText: string } | null> {
  const rows = await db
    .select({ sourceMetadata: incomingEvents.sourceMetadata, content: incomingEvents.content })
    .from(incomingEvents)
    .where(eq(incomingEvents.id, eventId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  const meta = row.sourceMetadata as Record<string, unknown>;
  const content = row.content as Record<string, unknown>;
  return {
    from:        typeof meta['from']          === 'string' ? meta['from']          : '',
    subject:     typeof meta['subject']       === 'string' ? meta['subject']       : '',
    threadId:    typeof meta['threadId']      === 'string' ? meta['threadId']      : '',
    bodyText:    typeof content['text']       === 'string' ? content['text']       : '',
    ...(typeof meta['rfcMessageId'] === 'string' && { rfcMessageId: meta['rfcMessageId'] }),
  };
}

// ── invoke_workflow trigger ───────────────────────────────────────────────────

function extractBrandName(fromAddress: string): string {
  // Prefer display name: "Acme Corp <contact@acme.com>" → "Acme Corp"
  const displayMatch = fromAddress.match(/^([^<]+)</);
  if (displayMatch !== null) {
    const name = (displayMatch[1] ?? '').trim();
    if (name.length > 0 && name.length < 60) return name;
  }
  // Fall back to domain without TLD: john@acme.com → "acme"
  const domainMatch = fromAddress.match(/@([^>@\s.]+)/);
  return domainMatch?.[1] ?? 'Unknown';
}

async function triggerWorkflowFromTriage(
  clientId: string,
  sourceEventId: string,
  workflowId: string,
): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('[triage-review] REDIS_URL missing — cannot trigger workflow');
    return;
  }

  // Look up the original inbound event (the prospect/trigger email).
  const eventMeta = await getEventMeta(sourceEventId);
  if (eventMeta === null) {
    console.error('[triage-review] source event not found:', sourceEventId);
    return;
  }

  // Confirm an active Gmail connection exists for the client.
  const connRows = await db
    .select({ emailAddress: oauthConnections.emailAddress })
    .from(oauthConnections)
    .where(
      and(
        eq(oauthConnections.clientId, clientId),
        eq(oauthConnections.provider, 'gmail'),
        eq(oauthConnections.status, 'active'),
      ),
    )
    .limit(1);

  if (connRows.length === 0) {
    console.error('[triage-review] no active Gmail connection for client:', clientId);
    return;
  }

  // Brand name comes from the INBOUND sender, not the client.
  const brandName = extractBrandName(eventMeta.from);

  // Construct a synthetic "Prospect: <brandName>" email in the format
  // parseProspectInput expects — subject prefix + Notes field for context.
  const syntheticSubject = `Prospect: ${brandName}`;
  const syntheticBody = `Notes: ${eventMeta.bodyText}`.slice(0, 4000);

  // The synthetic event's 'from' is the REAL inbound sender. The delivery
  // safety gate (domain comparison against clients.verified_domain) now lives
  // in the gmail-reply-with-attachment destination under mode:'verified-domain-gate'.
  // It resolves the recipient at delivery time — this caller no longer needs to
  // compute syntheticFrom. externalId null means the poller never touches this row.
  const [inserted] = await db
    .insert(incomingEvents)
    .values({
      clientId,
      source: 'email',
      sourceMetadata: {
        from:    eventMeta.from,
        to:      connRows[0]?.emailAddress ?? '',
        subject: syntheticSubject,
      },
      content: { text: syntheticBody },
      receivedAt: new Date(),
      status: 'received',
    })
    .returning({ id: incomingEvents.id });

  if (inserted === undefined) {
    console.error('[triage-review] failed to insert synthetic event');
    return;
  }

  console.info('[triage-review] enqueueing workflow job', {
    eventId: inserted.id,
    clientId,
    workflowId,
    redisUrlPrefix: redisUrl.slice(0, 20),
  });
  const queue = new Queue('incoming-events', { connection: { url: redisUrl } });
  try {
    const job = await queue.add('process', {
      eventId: inserted.id,
      clientId,
      directWorkflowId: workflowId,
    });
    console.info('[triage-review] enqueued job', { jobId: job.id, eventId: inserted.id });
  } catch (queueErr) {
    console.error('[triage-review] queue.add failed:', String(queueErr));
    throw queueErr;
  } finally {
    await queue.close();
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function approveItem(captureLogId: string, token: string): Promise<{ error?: string }> {
  try {
    const clientId = await resolveToken(token);
    if (clientId === null) return { error: 'This review link has expired. Please wait for the next digest.' };

    const originals = await getOriginals(captureLogId, clientId);
    if (originals === null) return { error: 'Item not found.' };

    // If this is an invoke_workflow item, enqueue the named workflow before
    // recording the decision. Trigger failures are logged but never rethrow —
    // the decision is recorded regardless so the item is cleared from the review page.
    if (originals.suggestedAction.startsWith('invoke_workflow:') && originals.eventId !== null) {
      const workflowId = originals.suggestedAction.slice('invoke_workflow:'.length);
      try {
        await triggerWorkflowFromTriage(clientId, originals.eventId, workflowId);
      } catch (triggerErr) {
        console.error('[triage-review] triggerWorkflowFromTriage threw — decision will still be recorded:', String(triggerErr));
      }
    }

    const markRead = await makeMark();
    await recordResolution(db, markRead, { captureLogId, decision: 'approved_as_is' });
    revalidatePath(`/review/${token}`);
    return {};
  } catch {
    return { error: 'Could not save your decision — please try again or contact support.' };
  }
}

export async function rejectItem(captureLogId: string, token: string): Promise<{ error?: string }> {
  try {
    const clientId = await resolveToken(token);
    if (clientId === null) return { error: 'This review link has expired. Please wait for the next digest.' };

    const originals = await getOriginals(captureLogId, clientId);
    if (originals === null) return { error: 'Item not found.' };

    // Delete the Gmail draft so a rejected reply does not linger as an
    // accidentally-sendable artefact.
    if (originals.gmailDraftId !== null && originals.gmailDraftId !== undefined) {
      const draftSvc = makeDraftService();
      if (draftSvc !== null) {
        await draftSvc.deleteDraft(clientId, originals.gmailDraftId);
      }
    }

    const markRead = await makeMark();
    await recordResolution(db, markRead, {
      captureLogId,
      decision: 'rejected',
      originalAction: originals.suggestedAction,
    });
    revalidatePath(`/review/${token}`);
    return {};
  } catch {
    return { error: 'Could not save your decision — please try again or contact support.' };
  }
}

export async function modifyAndApprove(
  captureLogId: string,
  finalText: string,
  token: string,
): Promise<{ error?: string }> {
  try {
    const clientId = await resolveToken(token);
    if (clientId === null) return { error: 'This review link has expired. Please wait for the next digest.' };

    const originals = await getOriginals(captureLogId, clientId);
    if (originals === null) return { error: 'Item not found.' };

    // Update the existing Gmail draft to match the edited text — no duplicate created.
    if (originals.gmailDraftId !== null && originals.gmailDraftId !== undefined) {
      const draftSvc = makeDraftService();
      if (draftSvc !== null) {
        const eventMeta = originals.eventId !== null
          ? await getEventMeta(originals.eventId)
          : null;
        if (eventMeta !== null) {
          const replySubject = eventMeta.subject.startsWith('Re: ')
            ? eventMeta.subject
            : `Re: ${eventMeta.subject}`;
          await draftSvc.updateDraft(clientId, originals.gmailDraftId, {
            to:      eventMeta.from,
            subject: replySubject,
            bodyText: finalText,
            ...(eventMeta.threadId      && { threadId: eventMeta.threadId }),
            ...(eventMeta.rfcMessageId  && { inReplyToMessageId: eventMeta.rfcMessageId }),
          });
        }
      }
    }

    const markRead = await makeMark();
    await recordResolution(db, markRead, {
      captureLogId,
      decision: 'modified',
      finalText,
      originalAction: originals.suggestedAction,
      ...(originals.draftText !== null && originals.draftText !== undefined && {
        originalText: originals.draftText,
      }),
    });
    revalidatePath(`/review/${token}`);
    return {};
  } catch {
    return { error: 'Could not save your decision — please try again or contact support.' };
  }
}
