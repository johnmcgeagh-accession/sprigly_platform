/**
 * request-email.ts — builds and creates a Gmail draft for the monthly content
 * request email (cycle scheduled → requested).
 *
 * Level 2 / human-approves-before-send: this worker creates a draft only.
 * No send call exists in this file or its dependencies.
 *
 * Month semantics:
 *   dataMonth   = cycleMonth (YYYY-MM) — the month whose data buildLeanLine analyses
 *   targetMonth = dataMonth + 1 calendar month — the month the email is planning for
 *
 * Call site: requestEmailStub in stubs.ts, which bootstraps the real deps.
 * Tests: import runRequestEmail directly with injected deps.
 */

import { eq, and } from 'drizzle-orm';
import {
  db as _db,
  clients,
  clientChannels,
  contentCycles,
} from '@sprigly/db';
import type { DriveApiClient } from '@sprigly/sources';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { Logger } from 'pino';
import { buildLeanLine, type PromptResolver } from '../lean-line.js';
import { transitionCycle } from './machine.js';
import { BASE_QUESTIONS, questionsForChannel } from '@sprigly/engine';

export { BASE_QUESTIONS };

type Db = typeof _db;

interface GmailDraftService {
  createDraft(
    clientId: string,
    params: { to: string; subject: string; bodyText: string },
  ): Promise<string | null>;
}

export interface RequestEmailDeps {
  db:                Db;
  drive:             DriveApiClient;
  gmailDraftService: GmailDraftService;
  model:             ModelClient;
  audit:             AuditLogger;
  logger:            Logger;
  prompts:           PromptResolver;
}

export const GREETING_INTRO      = "we've taken a look at last month's numbers. Here's where the data's pointing.";
export const QUESTION_TRANSITION  = "To shape next month's content, it'd help to hear your thinking on a few things:";
export const SIGN_OFF             = 'Thanks,\nThe Sprigly Team';

/** Advance YYYY-MM by one calendar month; handles December → January year rollover. */
export function addOneMonth(month: string): string {
  const [yearStr, monStr] = month.split('-');
  let y = Number(yearStr);
  let m = Number(monStr) + 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function buildMonthLabel(month: string): string {
  const [yearStr, monStr] = month.split('-');
  return new Date(Number(yearStr), Number(monStr) - 1, 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'Europe/London',
  });
}

export function buildBody({
  greeting,
  leanLine,
  questions,
}: {
  greeting: string;
  leanLine: string | null;
  questions: string[];
}): string {
  const questionLines = questions.map((q, i) => `${i + 1}. ${q}`);
  return [
    greeting,
    '',
    GREETING_INTRO,
    ...(leanLine ? ['', leanLine] : []),
    '',
    QUESTION_TRANSITION,
    '',
    ...questionLines,
    '',
    SIGN_OFF,
  ].join('\n');
}

export async function runRequestEmail(
  clientId: string,
  channel:  string,
  month:    string,   // dataMonth (cycleMonth) — analysed by lean-line
  deps:     RequestEmailDeps,
): Promise<void> {
  const { db, drive, gmailDraftService, model, audit, logger, prompts } = deps;
  const logCtx = { clientId, channel, month };

  // ── 1. Idempotency guard ──────────────────────────────────────────────────
  const cycleRows = await db
    .select()
    .from(contentCycles)
    .where(and(
      eq(contentCycles.clientId,   clientId),
      eq(contentCycles.channel,    channel),
      eq(contentCycles.cycleMonth, month),
    ))
    .limit(1);

  const cycle = cycleRows[0];
  if (!cycle) {
    throw new Error(
      `request-email: no content cycle for client=${clientId} channel=${channel} month=${month}`,
    );
  }

  if (cycle.status === 'requested') {
    logger.info({ ...logCtx, cycleId: cycle.id }, 'request-email: already requested — skipping');
    return;
  }

  // ── 2. Client name ────────────────────────────────────────────────────────
  const clientRows = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  const clientName = clientRows[0]?.name;
  if (!clientName) throw new Error(`request-email: client not found: ${clientId}`);

  // ── 3. Channel row: Drive folder + contact config ────────────────────────
  const channelRows = await db
    .select({
      driveFolderId:        clientChannels.driveFolderId,
      contactEmail:         clientChannels.contactEmail,
      contactName:          clientChannels.contactName,
      extraQuestions:       clientChannels.extraQuestions,
      contentCycleSchedule: clientChannels.contentCycleSchedule,
    })
    .from(clientChannels)
    .where(and(
      eq(clientChannels.clientId, clientId),
      eq(clientChannels.channel,  channel),
    ))
    .limit(1);

  const channelRow = channelRows[0];

  // ── Cohort gate: cutoffDay clients ask via the three-touch Ask (#4), not this legacy request
  // email. Return before assembling, sending, or transitioning — so 'requested' is left as a
  // transit-only status for them (auto-run drives scheduled → requested → intake_confirmed). The
  // discriminator is cutoffDay != null, the same signal as scheduler.ts:195/:393. Non-cutoffDay
  // channels fall through and keep the legacy request-email path unchanged.
  if (channelRow?.contentCycleSchedule?.cutoffDay != null) {
    logger.info(
      { ...logCtx, cycleId: cycle.id, cutoffDay: channelRow.contentCycleSchedule.cutoffDay },
      'request-email: skipped — cutoffDay client asks via the three-touch Ask (legacy request email gated off for this cohort)',
    );
    return;
  }

  const driveFolderId = channelRow?.driveFolderId;
  if (!driveFolderId) {
    throw new Error(`request-email: no driveFolderId for client=${clientId} channel=${channel}`);
  }

  const contactEmail = channelRow.contactEmail ?? undefined;
  if (!contactEmail) {
    throw new Error(
      `request-email: contact_email missing from client_channels for client=${clientId} channel=${channel}`,
    );
  }

  const contactName    = channelRow.contactName ?? null;
  // Shared derivation (base + this channel's extras, string-filtered) — same list the Ask email,
  // card, and intake panel use. Byte-identical to the prior local combine (filter + order match).
  const allQuestions   = questionsForChannel(channelRow);

  // ── 5. Lean line — uses dataMonth for data lookups ────────────────────────
  const leanLine = await buildLeanLine({
    clientId, clientName, channel, month, driveFolderId, drive, db, model, audit, logger, prompts,
  });

  // ── 6. Build draft ────────────────────────────────────────────────────────
  const dataMonth   = month;
  const targetMonth = addOneMonth(dataMonth);
  const monthLabel  = buildMonthLabel(targetMonth);
  const greeting    = contactName ? `Hi ${contactName},` : 'Hi there,';
  const body = buildBody({ greeting, leanLine, questions: allQuestions });

  // ── 7. Create Gmail draft — never send ───────────────────────────────────
  logger.info({ ...logCtx, subject: `${clientName}: content plan for ${monthLabel}`, bodyText: body },
    'request-email: assembled draft body');
  const draftId = await gmailDraftService.createDraft(clientId, {
    to:       contactEmail,
    subject:  `${clientName}: content plan for ${monthLabel}`,
    bodyText: body,
  });

  if (!draftId) {
    throw new Error(
      `request-email: createDraft returned null for client=${clientId} — leaving scheduled for retry`,
    );
  }

  // ── 8. Transition only after confirmed draft; error leaves cycle scheduled ─
  await transitionCycle(db, cycle.id, 'requested', { requestSentAt: new Date() }, logger);

  logger.info({
    ...logCtx,
    cycleId:         cycle.id,
    draftId,
    leanLinePresent: leanLine !== null,
    questionCount:   allQuestions.length,
    targetMonth,
  }, 'request-email: draft created, cycle → requested');
}
