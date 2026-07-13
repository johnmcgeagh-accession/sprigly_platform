/**
 * email-send.ts — resolve a published email template + deliver it through the SAME real-send
 * seam the app-ready notification uses (GmailReplyWithAttachment → gmail.users.messages.send),
 * ALWAYS pinned to the test inbox (Stage 1 — no client-facing email), with the CLIENT's Gmail
 * tokens. Best-effort: a missing template / send failure logs and returns false, never throws.
 *
 * The subject/body are fully rendered here (email-render, fail-loud) and passed to the seam as
 * literal templates with an empty merge object, so the seam's own {{}} substitution is a no-op
 * and this module is the single substitution engine for all four intake-capture emails.
 */
import { and, eq, desc } from 'drizzle-orm';
import { db as _db, emailTemplates, type EmailTemplateKey } from '@sprigly/db';
import { GmailReplyWithAttachment } from '@sprigly/destinations';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import type { DestinationConfig, DeliveryContext, IncomingEvent } from '@sprigly/engine';
import type { Logger } from 'pino';
import { renderEmailTemplate, type MergeData } from '@sprigly/engine';

type Db = typeof _db;

/** The pinned test-inbox recipient for ALL intake-capture sends. IDENTICAL to the app-ready
 *  pin (was planning.ts APP_DELIVERY_PIN) — deliberately NOT real client delivery (the deferred
 *  go-live toggle). Do not change without changing the go-live plan. */
export const APP_DELIVERY_PIN = 'john.mcgeagh@gmail.com';

export interface TemplateEmailDeps {
  db:                 Db;
  encProvider:        EncryptionProvider;
  googleClientId:     string;
  googleClientSecret: string;
  logger:             Logger;
}

/** Resolve the PUBLISHED template for a key (highest published version). Null if none. */
export async function getPublishedTemplate(
  db:  Db,
  key: EmailTemplateKey,
): Promise<{ subjectTemplate: string; bodyTemplate: string } | null> {
  const [row] = await db
    .select({ subjectTemplate: emailTemplates.subjectTemplate, bodyTemplate: emailTemplates.bodyTemplate })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.key, key), eq(emailTemplates.isPublished, true)))
    .orderBy(desc(emailTemplates.version))
    .limit(1);
  return row ?? null;
}

export interface TemplatedEmailInput {
  key:      EmailTemplateKey;
  clientId: string;
  merge:    MergeData;
}

/**
 * Resolve → render → deliver a templated email to the pinned inbox with the client's Gmail
 * tokens. Returns true on a confirmed send, false on any resolve/render/send failure (all
 * logged, never thrown — the caller decides whether to stamp a send-log column).
 */
export async function deliverTemplatedEmail(
  deps:  TemplateEmailDeps,
  input: TemplatedEmailInput,
): Promise<boolean> {
  const { db, encProvider, googleClientId, googleClientSecret, logger } = deps;
  const { key, clientId, merge } = input;

  const tpl = await getPublishedTemplate(db, key);
  if (!tpl) {
    logger.warn({ clientId, key }, 'email-send: no published template for key — not sent');
    return false;
  }

  let subject: string;
  let body: string;
  try {
    ({ subject, body } = renderEmailTemplate(tpl, merge));
  } catch (err) {
    logger.warn({ clientId, key, err: String(err) }, 'email-send: template render failed — not sent');
    return false;
  }

  try {
    const dest   = new GmailReplyWithAttachment(db, encProvider, googleClientId, googleClientSecret);
    const event  = { clientId, reply: { data: {} } } as unknown as IncomingEvent;
    const config = {
      settings: {
        to:           { mode: 'address', address: APP_DELIVERY_PIN },
        subjectTemplate: subject,   // already rendered — seam substitution is a no-op
        bodyTemplate:    body,
        noAttachment:    true,
      },
    } as unknown as DestinationConfig;
    const ctx = { clientId } as unknown as DeliveryContext;

    const result = await dest.deliver({}, event, config, ctx);
    if (result.success) {
      logger.info({ clientId, key, to: APP_DELIVERY_PIN }, 'email-send: sent (pinned test inbox)');
      return true;
    }
    logger.warn({ clientId, key, err: result.error }, 'email-send: not sent (non-fatal)');
    return false;
  } catch (err) {
    logger.warn({ clientId, key, err: String(err) }, 'email-send: send threw (non-fatal)');
    return false;
  }
}
