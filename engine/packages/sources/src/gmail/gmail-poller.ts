import { db as _db, incomingEvents, processedExternalIds, oauthConnections, gmailOperationErrors } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import type { EventRouter, IncomingEventDraft } from '@sprigly/engine';
import { matchRules } from '@sprigly/engine';
import { GmailApiClient } from './gmail-client.js';
import { extractMessageText, getHeader, parseReceivedAt } from './gmail-parser.js';

type Db = typeof _db;
type Logger = { warn(obj: object, msg: string): void; error(obj: object, msg: string): void };

export class GmailPoller {
  constructor(
    private db: Db,
    private encProvider: EncryptionProvider,
    private googleClientId: string,
    private googleClientSecret: string,
    private router: EventRouter,
    private logger: Logger = { warn: () => {}, error: () => {} },
  ) {}

  async poll(clientId: string): Promise<number> {
    // ── Load connection row ───────────────────────────────────────────────────
    const connRows = await this.db
      .select({
        lastPolledAt: oauthConnections.lastPolledAt,
      })
      .from(oauthConnections)
      .where(
        and(
          eq(oauthConnections.clientId, clientId),
          eq(oauthConnections.provider, 'gmail'),
        ),
      )
      .limit(1);

    const conn = connRows[0];
    if (conn === undefined) return 0;

    // ── Capture cycle-start time BEFORE any API calls ─────────────────────────
    // This timestamp becomes the new watermark only after the cycle succeeds.
    // If the cycle throws partway, last_polled_at is not advanced; the next
    // cycle re-fetches and the idempotency table handles any overlap.
    const cycleStart = new Date();

    // ── Null watermark: brand-new connection, first cycle ever ────────────────
    // setup-gmail-oauth.ts writes last_polled_at after storeTokens, but there
    // is a short window before that UPDATE commits. If a poll cycle fires in
    // that window, skip the message fetch entirely and set the watermark to
    // cycleStart so the next cycle starts from now. No tokens needed.
    if (conn.lastPolledAt === null) {
      await this.db
        .update(oauthConnections)
        .set({ lastPolledAt: cycleStart, updatedAt: new Date() })
        .where(
          and(
            eq(oauthConnections.clientId, clientId),
            eq(oauthConnections.provider, 'gmail'),
          ),
        );
      return 0;
    }

    // ── Get tokens and build Gmail client ─────────────────────────────────────
    const tokens = await getTokens(this.db, this.encProvider, clientId, 'gmail');
    if (tokens === null) return 0;

    const client = new GmailApiClient(
      this.googleClientId,
      this.googleClientSecret,
      tokens,
      (refreshed) => storeTokens(this.db, this.encProvider, clientId, 'gmail', refreshed),
      async (err) => {
        try {
          await this.db.insert(gmailOperationErrors).values({
            clientId,
            operation:    err.operation,
            externalId:   err.externalId ?? null,
            errorCode:    err.errorCode ?? null,
            errorMessage: err.errorMessage,
          });
        } catch { /* db write failure must not cascade */ }
        this.logger.error(
          { clientId, operation: err.operation, externalId: err.externalId, errorCode: err.errorCode, errorMessage: err.errorMessage },
          'gmail operation failed',
        );
      },
    );

    // ── Fetch messages since the watermark ────────────────────────────────────
    // lastPolledAt is guaranteed non-null here — the null case returned early above.
    const messageIds = await client.listMessageIds(conn.lastPolledAt);

    // Load routing rules once for the cycle — avoids a DB query per message.
    const rules = await this.router.loadRules(clientId, 'email');
    let count = 0;

    for (const messageId of messageIds) {
      // ── 1. Idempotency check ───────────────────────────────────────────────
      // A message can re-appear in the watermark window if the cycle was
      // interrupted before last_polled_at advanced. Skip entirely — no mark-read,
      // no re-evaluation.
      const existing = await this.db
        .select({ id: processedExternalIds.id })
        .from(processedExternalIds)
        .where(
          and(
            eq(processedExternalIds.clientId, clientId),
            eq(processedExternalIds.source, 'gmail'),
            eq(processedExternalIds.externalId, messageId),
          ),
        )
        .limit(1);

      if (existing[0] !== undefined) continue;

      // ── 2. Fetch and parse ────────────────────────────────────────────────
      const message = await client.getMessage(messageId);
      const headers  = message.payload?.headers ?? [];
      const text     = extractMessageText(message);
      const subject  = getHeader(headers, 'Subject');
      const from     = getHeader(headers, 'From');
      const to       = getHeader(headers, 'To');
      const date     = getHeader(headers, 'Date');
      const receivedAt = parseReceivedAt(message);

      const draft: IncomingEventDraft = {
        clientId,
        source: 'email',
        sourceMetadata: { messageId, threadId: message.threadId ?? '', from, to, subject, date },
        content: { text, structured: { subject } },
      };

      // ── 3. Match routing rules (pure — no DB, no side effects) ────────────
      const matched = matchRules(draft, rules);

      if (matched.length === 0) {
        // Unmatched: record idempotency only. Do NOT mark as read. The email
        // stays in the client's inbox exactly as they left it.
        // In full mode this branch is effectively dead once the match-all
        // fallback rule exists (Stage 3) — but if somehow nothing matches,
        // leaving the email untouched is the safe default (not force-persisting
        // an event with no workflow to route to).
        await this.db.insert(processedExternalIds).values({
          clientId,
          source:      'gmail',
          externalId:  messageId,
          processedAt: new Date(),
        });
        continue;
      }

      // ── 4. Matched: persist → idempotency record → mark read ─────────────
      // Both inserts are wrapped in a transaction so they commit atomically.
      // If the process dies between them, neither is committed: no orphaned
      // incomingEvents row, no missing idempotency record. The next cycle
      // re-processes the message cleanly.
      // markAsRead stays outside — the Gmail API is not transactional. Worst
      // case after a crash here: event was processed but the email stays
      // unread. The idempotency record prevents a duplicate run next cycle.
      await this.db.transaction(async (tx) => {
        await tx.insert(incomingEvents).values({
          clientId,
          source:         'email',
          sourceMetadata: draft.sourceMetadata,
          content:        draft.content as Record<string, unknown>,
          receivedAt,
          status:         'received',
          externalId:     messageId,
        });

        await tx.insert(processedExternalIds).values({
          clientId,
          source:      'gmail',
          externalId:  messageId,
          processedAt: new Date(),
        });
      });

      await client.markAsRead(messageId);
      count++;
    }

    // ── Advance watermark ─────────────────────────────────────────────────────
    // Only reached if the loop completed without throwing. cycleStart was
    // captured before the first API call, so emails that arrived during
    // processing will be included in the next cycle's window.
    await this.db
      .update(oauthConnections)
      .set({ lastPolledAt: cycleStart, updatedAt: new Date() })
      .where(
        and(
          eq(oauthConnections.clientId, clientId),
          eq(oauthConnections.provider, 'gmail'),
        ),
      );

    return count;
  }
}
