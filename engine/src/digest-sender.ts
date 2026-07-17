import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import {
  db as _db,
  triageConfigs,
  triageDigestTokens,
  triageCaptureLog,
  incomingEvents,
  oauthConnections,
  processedExternalIds,
  routingRules,
} from '@sprigly/db';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider, OAuthTokenBundle } from '@sprigly/oauth-tokens';
import { composeDigestEmail } from '@sprigly/destinations';
import type { Logger } from 'pino';

type Db = typeof _db;

// The triage digest is one leg of the inbox-triage PROCESS; the routing rule is the other. The
// process is "on" only while at least one sprigly-inbox-triage routing rule is enabled — the same
// flag classification reads in event-router.ts. When every such rule is disabled (or none exists),
// the process is off and the digest must stop too, otherwise "disabled" only silences new
// classification while the nagging continues. See sendDigestsForAllClients for the gate.
const TRIAGE_WORKFLOW_ID = 'sprigly-inbox-triage';

// ── Cadence helpers ────────────────────────────────────────────────────────────

type DigestCadence = 'twice_daily' | 'end_of_day' | 'end_of_week';

/**
 * Returns true if a digest should fire NOW given the cadence and the last
 * time one was sent. All checks are in UTC.
 *
 * end_of_day:   hour >= 17, and lastSentAt is null or was before today's 17:00.
 * twice_daily:  hour >= 9 and lastSentAt before today's 09:00, OR
 *               hour >= 17 and lastSentAt before today's 17:00.
 * end_of_week:  day is Friday (getDay()===5), hour >= 17, and lastSentAt is
 *               null or was before this Friday's 17:00.
 *
 * The 15-minute tick means each window fires at most once: once lastDigestSentAt
 * is written within the window, the "before window start" check blocks re-fire
 * even if the worker restarts.
 */
function shouldSendDigest(cadence: DigestCadence, lastSentAt: Date | null, now: Date): boolean {
  const h = now.getUTCHours();
  const day = now.getUTCDay(); // 0=Sun, 5=Fri

  // Window start timestamps for today.
  const todayMorning = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 0, 0));
  const todayEvening = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0));

  const sentBeforeMorning = lastSentAt === null || lastSentAt < todayMorning;
  const sentBeforeEvening = lastSentAt === null || lastSentAt < todayEvening;

  if (cadence === 'end_of_day') {
    return h >= 17 && sentBeforeEvening;
  }
  if (cadence === 'twice_daily') {
    return (h >= 9 && sentBeforeMorning) || (h >= 17 && sentBeforeEvening);
  }
  if (cadence === 'end_of_week') {
    return day === 5 && h >= 17 && sentBeforeEvening;
  }
  return false;
}

// ── Token lookup-or-create ────────────────────────────────────────────────────

/**
 * Returns an active token for the client, refreshing its expiry to +72h.
 * Mints a new token only when none is unexpired.
 * Ensures exactly one active token per tenant at all times.
 */
async function upsertDigestToken(db: Db, clientId: string, now: Date): Promise<string> {
  const newExpiry = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  const existing = await db
    .select({ id: triageDigestTokens.id, token: triageDigestTokens.token })
    .from(triageDigestTokens)
    .where(
      and(
        eq(triageDigestTokens.clientId, clientId),
        gt(triageDigestTokens.expiresAt, now),
      ),
    )
    .limit(1);

  if (existing[0] !== undefined) {
    // Reuse: slide the expiry forward.
    await db
      .update(triageDigestTokens)
      .set({ expiresAt: newExpiry })
      .where(eq(triageDigestTokens.id, existing[0].id));
    return existing[0].token;
  }

  // Mint a new token.
  const token = randomBytes(32).toString('hex');
  await db.insert(triageDigestTokens).values({ clientId, token, expiresAt: newExpiry });
  return token;
}

// ── Gmail client builder ──────────────────────────────────────────────────────

interface GmailClientResult {
  gmail: ReturnType<typeof google.gmail>;
  emailAddress: string;
}

async function buildGmailClient(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  clientId: string,
  knownEmail: string | null,
  logger: Logger,
): Promise<GmailClientResult | null> {
  const tokens = await getTokens(db, encProvider, clientId, 'gmail');
  if (tokens === null) {
    logger.warn({ clientId }, 'digest: no Gmail tokens, skipping');
    return null;
  }

  let currentTokens: OAuthTokenBundle = tokens;

  const auth = new google.auth.OAuth2(googleClientId, googleClientSecret);
  auth.setCredentials({
    access_token: tokens.accessToken,
    ...(tokens.refreshToken !== undefined && { refresh_token: tokens.refreshToken }),
    ...(tokens.expiresAt !== undefined && { expiry_date: tokens.expiresAt }),
  });

  auth.on('tokens', (newTokens) => {
    const newRefreshToken =
      typeof newTokens.refresh_token === 'string' ? newTokens.refresh_token : undefined;
    const refreshed: OAuthTokenBundle = {
      accessToken: newTokens.access_token ?? currentTokens.accessToken,
      scopes: currentTokens.scopes,
      ...(newRefreshToken !== undefined
        ? { refreshToken: newRefreshToken }
        : currentTokens.refreshToken !== undefined
          ? { refreshToken: currentTokens.refreshToken }
          : {}),
      ...(newTokens.expiry_date != null && { expiresAt: newTokens.expiry_date }),
      ...(currentTokens.emailAddress !== undefined && { emailAddress: currentTokens.emailAddress }),
    };
    currentTokens = refreshed;
    void storeTokens(db, encProvider, clientId, 'gmail', refreshed);
  });

  const gmail = google.gmail({ version: 'v1', auth });

  // Resolve email address: connection column → token bundle → Gmail profile API.
  let emailAddress = knownEmail ?? tokens.emailAddress ?? '';
  if (emailAddress === '') {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    emailAddress = profile.data.emailAddress ?? '';
  }

  if (emailAddress === '') {
    logger.warn({ clientId }, 'digest: could not resolve email address from connection, tokens, or Gmail profile — skipping');
    return null;
  }

  return { gmail, emailAddress };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function sendDigestsForAllClients(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  adminBaseUrl: string,   // the /review/<token> route lives in admin/ — admin origin
  logger: Logger,
): Promise<void> {
  const now = new Date();

  const configs = await db
    .select({
      configId:         triageConfigs.id,
      clientId:         triageConfigs.clientId,
      digestCadence:    triageConfigs.digestCadence,
      lastDigestSentAt: triageConfigs.lastDigestSentAt,
      emailAddress:     oauthConnections.emailAddress,
    })
    .from(triageConfigs)
    .innerJoin(
      oauthConnections,
      and(
        eq(oauthConnections.clientId, triageConfigs.clientId),
        eq(oauthConnections.provider, 'gmail'),
        eq(oauthConnections.status, 'active'),
      ),
    );

  // Triage-process gate (computed with the client set, not deep in the send path): the set of
  // clients whose inbox-triage process is ON — i.e. that have at least one ENABLED
  // sprigly-inbox-triage routing rule. A client not in this set has every such rule disabled, or
  // none at all, and is skipped below. This reads the SAME enabled flag as classification; it
  // never touches triage_capture_log, so pending items are retained and resume on re-enable.
  const enabledTriageRules = await db
    .select({ clientId: routingRules.clientId })
    .from(routingRules)
    .where(and(eq(routingRules.workflowId, TRIAGE_WORKFLOW_ID), eq(routingRules.enabled, true)));
  const triageEnabledClientIds = new Set(enabledTriageRules.map((r) => r.clientId));

  for (const config of configs) {
    const cadence = (config.digestCadence ?? 'end_of_day') as
      'twice_daily' | 'end_of_day' | 'end_of_week';

    if (!shouldSendDigest(cadence, config.lastDigestSentAt, now)) continue;

    // Process disabled: a digest was due, but no enabled inbox-triage rule means the process is
    // off — skip WITHOUT stamping last_digest_sent_at and WITHOUT touching the pending queue. Log
    // the reason: a silent skip is indistinguishable from a broken sender.
    if (!triageEnabledClientIds.has(config.clientId)) {
      logger.info(
        { clientId: config.clientId },
        'digest: inbox-triage process disabled (no enabled sprigly-inbox-triage routing rule) — skipping; last_digest_sent_at unchanged, pending items retained',
      );
      continue;
    }

    try {
      // Pending items: decision IS NULL, joined to incoming_events for subject/from.
      const pending = await db
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
            eq(triageCaptureLog.clientId, config.clientId),
            isNull(triageCaptureLog.decision),
          ),
        );

      if (pending.length === 0) {
        logger.info({ clientId: config.clientId }, 'digest: no pending items, skipping');
        continue;
      }

      const gmailClient = await buildGmailClient(
        db, encProvider, googleClientId, googleClientSecret,
        config.clientId, config.emailAddress ?? null, logger,
      );
      if (gmailClient === null) continue;

      const { gmail, emailAddress } = gmailClient;

      const token = await upsertDigestToken(db, config.clientId, now);
      const reviewUrl = `${adminBaseUrl}/review/${token}`;

      const items = pending.map((row) => {
        const meta = row.sourceMetadata as Record<string, unknown>;
        return {
          captureLogId:     row.captureLogId,
          category:         row.category,
          suggestedAction:  row.suggestedAction,
          subject:          typeof meta['subject'] === 'string' ? meta['subject'] : '(no subject)',
          from:             typeof meta['from'] === 'string' ? meta['from'] : '(unknown sender)',
          ...(row.draftText !== null && row.draftText !== undefined && { draftText: row.draftText }),
          ...(row.escalationReason !== null && row.escalationReason !== undefined && { escalationReason: row.escalationReason }),
        };
      });

      const rawMessage = composeDigestEmail({
        toEmail:    emailAddress,
        fromEmail:  emailAddress,
        clientName: emailAddress,
        reviewUrl,
        items,
      });

      const encoded = Buffer.from(rawMessage).toString('base64url');
      const sentRes = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });

      // Register the sent digest message ID so the poller never routes it into
      // the triage workflow.
      const sentMessageId = sentRes.data.id;
      if (sentMessageId) {
        await db.insert(processedExternalIds).values({
          clientId: config.clientId,
          source: 'gmail',
          externalId: sentMessageId,
          processedAt: new Date(),
        }).onConflictDoNothing();
      }

      await db
        .update(triageConfigs)
        .set({ lastDigestSentAt: now, updatedAt: now })
        .where(eq(triageConfigs.id, config.configId));

      logger.info(
        { clientId: config.clientId, itemCount: items.length, toEmail: emailAddress },
        'digest sent',
      );
    } catch (err) {
      // Per-tenant failure must not abort other tenants.
      logger.error({ clientId: config.clientId, err: String(err) }, 'digest send failed');
    }
  }
}
