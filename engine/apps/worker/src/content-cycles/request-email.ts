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
import type { Logger } from 'pino';
import { buildLeanLine, type PromptResolver } from '../lean-line.js';
import { transitionCycle } from './machine.js';

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
  logger:            Logger;
  prompts:           PromptResolver;
}

export const BASE_QUESTIONS = [
  'Any key dates next month? Launches, events, deadlines.',
  "Anything new or returning to feature, or anything you'd rather we held back?",
  'Any specific looks, themes, or formats you want this month?',
  "Any stories worth telling? A behind-the-scenes moment, a customer story, something you're proud of.",
  'Anything specific you need driven this month?',
] as const;

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
  const { db, drive, gmailDraftService, model, logger, prompts } = deps;
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

  // ── 3. Drive folder ───────────────────────────────────────────────────────
  const channelRows = await db
    .select({ driveFolderId: clientChannels.driveFolderId })
    .from(clientChannels)
    .where(and(
      eq(clientChannels.clientId, clientId),
      eq(clientChannels.channel,  channel),
    ))
    .limit(1);

  const driveFolderId = channelRows[0]?.driveFolderId;
  if (!driveFolderId) {
    throw new Error(`request-email: no driveFolderId for client=${clientId} channel=${channel}`);
  }

  // ── 4. calendar-config.json: recipient, contact name, per-client extras ──
  const folderFiles = await drive.listFiles(driveFolderId);
  const configMeta  = folderFiles.find((f) => f.name === 'calendar-config.json');
  if (!configMeta) {
    throw new Error(
      `request-email: calendar-config.json not found for client=${clientId} channel=${channel}`,
    );
  }
  const configBuf = await drive.downloadFile(configMeta.id);
  const config    = JSON.parse(configBuf.toString('utf-8')) as Record<string, unknown>;

  const contactEmail = typeof config['contact_email'] === 'string'
    ? config['contact_email']
    : undefined;
  if (!contactEmail) {
    throw new Error(
      `request-email: contact_email missing from calendar-config.json for client=${clientId} channel=${channel}`,
    );
  }

  // contact_name preferred; fall back to contact if it's a plain name (no @)
  const contactName = (() => {
    const name = config['contact_name'] as string | undefined;
    if (name) return name;
    const contact = config['contact'] as string | undefined;
    if (contact && !contact.includes('@')) return contact;
    return null;
  })();

  const extraQuestions = Array.isArray(config['extra_questions'])
    ? (config['extra_questions'] as unknown[]).filter((q): q is string => typeof q === 'string')
    : [];

  // ── 5. Lean line — uses dataMonth for data lookups ────────────────────────
  const leanLine = await buildLeanLine({
    clientId, clientName, channel, month, driveFolderId, drive, model, logger, prompts,
  });

  // ── 6. Build draft ────────────────────────────────────────────────────────
  const dataMonth   = month;
  const targetMonth = addOneMonth(dataMonth);
  const monthLabel  = buildMonthLabel(targetMonth);
  const greeting    = contactName ? `Hi ${contactName},` : 'Hi there,';
  const allQuestions = [...BASE_QUESTIONS, ...extraQuestions];
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
