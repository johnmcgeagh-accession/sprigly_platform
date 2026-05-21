import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import {
  db as _db,
  triageConfigs,
  triageDigestTokens,
  triageCaptureLog,
  incomingEvents,
  oauthConnections,
} from '@sprigly/db';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider, OAuthTokenBundle } from '@sprigly/oauth-tokens';
import { composeDigestEmail } from '@sprigly/destinations';
import type { Logger } from 'pino';

type Db = typeof _db;

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

// ── Gmail send ────────────────────────────────────────────────────────────────

async function sendViaGmail(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  clientId: string,
  rawMessage: string,
  logger: Logger,
): Promise<boolean> {
  const tokens = await getTokens(db, encProvider, clientId, 'gmail');
  if (tokens === null) {
    logger.warn({ clientId }, 'digest: no Gmail tokens, skipping');
    return false;
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
  const encoded = Buffer.from(rawMessage).toString('base64url');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
  return true;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function sendDigestsForAllClients(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  appBaseUrl: string,
  logger: Logger,
): Promise<void> {
  const now = new Date();

  // Load all clients that have a triage_configs row AND an active Gmail connection.
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

  for (const config of configs) {
    const cadence = (config.digestCadence ?? 'end_of_day') as
      'twice_daily' | 'end_of_day' | 'end_of_week';

    if (!shouldSendDigest(cadence, config.lastDigestSentAt, now)) continue;

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

      // email_address on oauth_connections is nullable; fall back to the address
      // stored in the encrypted token bundle (same pattern as GmailSendNotification).
      let toEmail = config.emailAddress ?? '';
      if (toEmail === '') {
        const tokens = await getTokens(db, encProvider, config.clientId, 'gmail');
        toEmail = tokens?.emailAddress ?? '';
      }
      if (toEmail === '') {
        logger.warn({ clientId: config.clientId }, 'digest: no email address in connection or tokens, skipping');
        continue;
      }

      const token = await upsertDigestToken(db, config.clientId, now);
      const reviewUrl = `${appBaseUrl}/review/${token}`;

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
        toEmail,
        fromEmail: toEmail,
        clientName: toEmail,
        reviewUrl,
        items,
      });

      const sent = await sendViaGmail(
        db, encProvider, googleClientId, googleClientSecret,
        config.clientId, rawMessage, logger,
      );

      if (sent) {
        await db
          .update(triageConfigs)
          .set({ lastDigestSentAt: now, updatedAt: now })
          .where(eq(triageConfigs.id, config.configId));

        logger.info(
          { clientId: config.clientId, itemCount: items.length },
          'digest sent',
        );
      }
    } catch (err) {
      // Per-tenant failure must not abort other tenants.
      logger.error({ clientId: config.clientId, err: String(err) }, 'digest send failed');
    }
  }
}
