import { db as _db, workflowRuns, oauthConnections } from '@sprigly/db';
import { eq, and, sql } from 'drizzle-orm';
import { getTokens, storeTokens, isInvalidGrant, markConnectionError } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { GmailApiClient, extractMessageText } from '@sprigly/sources';
import { ingestSource } from '@sprigly/knowledge';
import type { IngestDeps } from '@sprigly/knowledge';

type Db = typeof _db;
type Logger = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
};

function patchRunOutput(db: Db, runId: string, patch: Record<string, string>): Promise<unknown> {
  return db
    .update(workflowRuns)
    .set({
      output: sql`COALESCE(${workflowRuns.output}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(eq(workflowRuns.id, runId));
}

async function checkSentDraftsForClient(
  clientId: string,
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  ingestDeps: IngestDeps,
  logger: Logger,
): Promise<void> {
  const pendingRuns = await db
    .select({
      id:        workflowRuns.id,
      clientId:  workflowRuns.clientId,
      startedAt: workflowRuns.startedAt,
      output:    workflowRuns.output,
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflowId, 'sprigly-question-answerer'),
        eq(workflowRuns.clientId, clientId),
        sql`${workflowRuns.output}->>'gmailDraftId' IS NOT NULL`,
        sql`${workflowRuns.output}->>'feedbackIngestedAt' IS NULL`,
        sql`${workflowRuns.output}->>'feedbackDiscardedAt' IS NULL`,
      ),
    );

  if (pendingRuns.length === 0) return;

  const tokens = await getTokens(db, encProvider, clientId, 'gmail');
  if (tokens === null) return;

  const gmailClient = new GmailApiClient(
    googleClientId,
    googleClientSecret,
    tokens,
    (refreshed) => storeTokens(db, encProvider, clientId, 'gmail', refreshed),
  );

  for (const run of pendingRuns) {
    const output = run.output as {
      gmailDraftId?: string;
      draftText?: string;
      threadId?: string;
    } | null;

    if (output == null) continue;
    const { gmailDraftId, draftText, threadId } = output;
    if (!gmailDraftId || !threadId) continue;

    try {
      const draftStillExists = await gmailClient.getDraft(gmailDraftId);
      // Still exists — not actioned yet. No flag; re-check next cycle.
      if (draftStillExists) continue;

      // Draft is gone — check whether it was sent or just deleted.
      const sentIds = await gmailClient.listSentByThread(threadId, run.startedAt);

      if (sentIds.length === 0) {
        await patchRunOutput(db, run.id, { feedbackDiscardedAt: new Date().toISOString() });
        logger.info({ runId: run.id, clientId }, 'Q&A draft deleted without sending — marked discarded');
        continue;
      }

      if (sentIds.length > 1) {
        logger.info(
          { runId: run.id, clientId, count: sentIds.length },
          'multiple sent messages in Q&A thread window — taking earliest',
        );
      }

      // Gmail returns newest-first; last element is the earliest in the window — the
      // first reply after the draft was created, i.e. the one that replaced our draft.
      const sentMessageId = sentIds[sentIds.length - 1]!;
      const sentMessage = await gmailClient.getMessage(sentMessageId);
      const sentBody = extractMessageText(sentMessage);

      if (sentBody.trim() === '') {
        logger.warn({ runId: run.id, clientId, sentMessageId }, 'sent message body empty — skipping ingest');
        continue;
      }

      await ingestSource(
        clientId,
        { sourceType: 'approved_draft', text: sentBody, ref: run.id },
        ingestDeps,
      );

      await patchRunOutput(db, run.id, { feedbackIngestedAt: new Date().toISOString() });

      const edited = typeof draftText === 'string' && draftText !== sentBody;
      logger.info(
        {
          runId:          run.id,
          clientId,
          edited,
          originalLength: typeof draftText === 'string' ? draftText.length : null,
          sentLength:     sentBody.length,
        },
        edited
          ? 'Q&A feedback ingested — draft was edited before sending'
          : 'Q&A feedback ingested — sent as-is',
      );
    } catch (err) {
      // A revoked/expired refresh token throws invalid_grant on the first Gmail call.
      // Mark the connection unhealthy (status='error' → dropped from the active poll
      // set) and bail this client instead of hammering every run every 60s.
      if (isInvalidGrant(err)) {
        const transitioned = await markConnectionError(db, clientId, 'gmail', String(err));
        if (transitioned) {
          logger.error({ clientId }, 'check-sent-drafts: gmail invalid_grant — connection marked error, backing off until reconnect');
        }
        return;
      }
      logger.error({ runId: run.id, clientId, err: String(err) }, 'check-sent-drafts: run check failed');
    }
  }
}

export async function checkSentDraftsForAllClients(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  ingestDeps: IngestDeps,
  logger: Logger,
): Promise<void> {
  const connections = await db
    .select({ clientId: oauthConnections.clientId })
    .from(oauthConnections)
    .where(and(eq(oauthConnections.provider, 'gmail'), eq(oauthConnections.status, 'active')));

  for (const { clientId } of connections) {
    try {
      await checkSentDraftsForClient(
        clientId, db, encProvider, googleClientId, googleClientSecret, ingestDeps, logger,
      );
    } catch (err) {
      logger.error({ clientId, err: String(err) }, 'check-sent-drafts: client check failed');
    }
  }
}
