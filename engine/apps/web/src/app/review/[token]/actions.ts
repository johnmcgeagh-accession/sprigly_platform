'use server';

// This action surface is narrow by design: approve/modify/reject only.
// It exposes nothing about the tenant beyond what's needed to act on a
// triage suggestion. Token is re-validated on every action — not just
// on page load — so a leaked or expired token cannot submit.

import { db, triageDigestTokens, triageCaptureLog } from '@sprigly/db';
import { eq, and, gt } from 'drizzle-orm';
import { recordResolution } from '@sprigly/engine';
import { createGmailReadStateService } from '@sprigly/sources';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { revalidatePath } from 'next/cache';

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

async function getOriginals(captureLogId: string, clientId: string) {
  const rows = await db
    .select({
      suggestedAction: triageCaptureLog.suggestedAction,
      draftText:       triageCaptureLog.draftText,
    })
    .from(triageCaptureLog)
    .where(
      and(
        eq(triageCaptureLog.id, captureLogId),
        // Scope to this tenant — no cross-tenant access possible.
        eq(triageCaptureLog.clientId, clientId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function approveItem(captureLogId: string, token: string): Promise<{ error?: string }> {
  try {
    const clientId = await resolveToken(token);
    if (clientId === null) return { error: 'This review link has expired. Please wait for the next digest.' };

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
