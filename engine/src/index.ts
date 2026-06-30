import { env } from './env.js';
import pino from 'pino';
import { randomBytes } from 'node:crypto';
import { db, processedExternalIds, contentCycles, clientChannels, appMagicLinkTokens } from '@sprigly/db';
import { and, eq } from 'drizzle-orm';
import { transitionCycle } from './content-cycles/machine.js';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { ZodError } from 'zod';
import { createAuditLogger } from '@sprigly/audit';
import { DbPromptResolver } from '@sprigly/prompts';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import {
  WorkflowRegistry,
  EventRouter,
  WorkflowRunner,
  DestinationDispatcher,
} from '@sprigly/engine';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCalendarConsumer } from './calendar-consumer.js';
import { createContentCycleConsumer } from './content-cycles/consumer.js';
import { runVoiceBatchMerge } from './voice-batch-merge.js';
import {
  spriglyBlogPostWorkflow,
  spriglyProspectResearchWorkflow,
  spriglyInboxNoopWorkflow,
  spriglyInboxTriageWorkflow,
  spriglyQuestionAnswererWorkflow,
  createCalendarBuildWorkbookWorkflow,
} from '@sprigly/workflows';

const __filename       = fileURLToPath(import.meta.url);
const __dirname        = dirname(__filename);
const calScriptPath    = join(__dirname, '../scripts/calendar/generate_calendar.py');
const extractScriptPath = join(__dirname, '../scripts/calendar/extract_edits.py');
import { TavilyProvider } from '@sprigly/web-search';
import { GmailPoller, createGmailReadStateService, createGmailDraftService } from '@sprigly/sources';
import {
  DbSaveBlogPost,
  DbSaveOutput,
  GmailSendNotification,
  GmailReplyWithAttachment,
} from '@sprigly/destinations';
import { Queue } from 'bullmq';
import { pollAllClients } from './poller.js';
import { DrivePoller } from './drive-poller.js';
import { createConsumer } from './consumer.js';
import { sendDigestsForAllClients } from './digest-sender.js';
import { checkSentDraftsForAllClients } from './check-sent-drafts.js';
import type { IngestDeps } from '@sprigly/knowledge';

const logger = pino({ name: 'sprigly-worker' });
logger.info('Worker starting');

let model: ReturnType<typeof createModelClientFromEnv>;
try {
  model = createModelClientFromEnv();
} catch (err) {
  if (err instanceof ZodError) {
    const lines = err.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    logger.fatal(`Model client configuration error — fix env vars and restart:\n${lines}`);
  } else {
    logger.fatal({ err }, 'Failed to create model client');
  }
  process.exit(1);
}
const audit = createAuditLogger(db);
const prompts = new DbPromptResolver(db);
const encProvider = createEncryptionProvider();

let embeddingClient: ReturnType<typeof createEmbeddingClientFromEnv>;
try {
  embeddingClient = createEmbeddingClientFromEnv();
} catch (err) {
  if (err instanceof ZodError) {
    const lines = err.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    logger.fatal(`Embedding client configuration error — fix env vars and restart:\n${lines}`);
  } else {
    logger.fatal({ err }, 'Failed to create embedding client');
  }
  process.exit(1);
}

const registry = new WorkflowRegistry();
registry.register(spriglyBlogPostWorkflow);
registry.register(spriglyProspectResearchWorkflow);
registry.register(spriglyInboxNoopWorkflow);
registry.register(spriglyInboxTriageWorkflow);
registry.register(spriglyQuestionAnswererWorkflow);
registry.register(createCalendarBuildWorkbookWorkflow(
  db, encProvider,
  env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET,
  calScriptPath, env.CAL_PYTHON_BIN,
  async (clientId, externalId) => {
    await db.insert(processedExternalIds).values({
      clientId, source: 'drive-self-write', externalId, processedAt: new Date(),
    });
    logger.debug({ clientId, externalId }, 'drive: self-write ledger entry recorded');
  },
  // onWorkbookBuilt: advance the cycle planning → workbook_built. Matched by
  // draft_csv_ref = csvFileId (the exact CSV the cycle produced), NOT by month —
  // the plan/workbook month is the cycle's data month + 1, so month matching would
  // miss. Guarded by status='planning' (idempotent; safe no-op once past planning).
  async (clientId, channel, csvFileId, workbookFileId) => {
    try {
      const cycleRows = await db
        .select({ id: contentCycles.id })
        .from(contentCycles)
        .where(and(
          eq(contentCycles.clientId,    clientId),
          eq(contentCycles.draftCsvRef, csvFileId),
          eq(contentCycles.status,      'planning'),
        ))
        .limit(1);
      const cycle = cycleRows[0];
      if (!cycle) {
        logger.info({ clientId, channel, csvFileId }, 'build-workbook: no planning cycle for this CSV — skipping workbook_built');
        return;
      }
      await transitionCycle(db, cycle.id, 'workbook_built', { workbookRef: workbookFileId }, logger);
      logger.info({ clientId, channel, csvFileId, cycleId: cycle.id }, 'build-workbook: planning → workbook_built');
    } catch (err) {
      logger.warn({ clientId, channel, csvFileId, err: String(err) }, 'build-workbook: could not advance cycle to workbook_built — non-fatal');
    }
  },
  // deliverySurfaceFor: per-channel delivery preference (default 'both').
  async (clientId, channel) => {
    try {
      const [row] = await db
        .select({ s: clientChannels.deliverySurface })
        .from(clientChannels)
        .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
        .limit(1);
      const s = row?.s;
      return s === 'app' || s === 'sheet' || s === 'both' ? s : 'both';
    } catch { return 'both'; }
  },
  // mintAppLink: revocable app magic link for the cycle being delivered (matched by
  // draft_csv_ref = csvFileId). Mirrors admin's copyClientLink / app's signLink.
  async (clientId, channel, csvFileId) => {
    try {
      const [cycle] = await db
        .select({ id: contentCycles.id })
        .from(contentCycles)
        .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.draftCsvRef, csvFileId)))
        .limit(1);
      if (!cycle) return null;
      const token = randomBytes(32).toString('base64url');
      await db.insert(appMagicLinkTokens).values({
        clientId, cycleId: cycle.id, token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      });
      const base = (process.env.APP_BASE_URL ?? 'https://app.sprigly.co.uk').replace(/\/$/, '');
      return `${base}/p/${token}`;
    } catch { return null; }
  },
));
logger.info(
  { workflows: ['sprigly-blog-post', 'sprigly-prospect-research', 'sprigly-inbox-noop', 'sprigly-inbox-triage', 'sprigly-question-answerer', 'sprigly-calendar-build-workbook'] },
  'Registered workflows',
);

const router = new EventRouter(db);
const search = new TavilyProvider();
const gmailDraftService = createGmailDraftService(db, encProvider, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
const runner = new WorkflowRunner(db, registry, model, audit, prompts, search, gmailDraftService, embeddingClient);

const dispatcher = new DestinationDispatcher(db);
dispatcher.register(new DbSaveBlogPost(db));
dispatcher.register(new DbSaveOutput(db));
dispatcher.register(
  new GmailSendNotification(db, encProvider, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
);
dispatcher.register(
  new GmailReplyWithAttachment(db, encProvider, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
);
logger.info(
  { destinations: ['db-save-blog-post', 'db-save-output', 'gmail-send-notification', 'gmail-reply-with-attachment'] },
  'Registered destinations',
);

// Read-state service used by the consumer to mark emails as read after a
// successful workflow run with outcome !== needs_human.
// Errors are logged to gmail_operation_errors and never rethrown.
const readStateService = createGmailReadStateService(
  db,
  encProvider,
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
);

const gmailPoller = new GmailPoller(db, encProvider, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, router, logger);

const ingestDeps: IngestDeps = {
  db,
  model,
  embeddingClient,
  labelModel: 'haiku',
};

const queue              = new Queue('incoming-events', { connection: { url: env.REDIS_URL } });
const calendarQueue      = new Queue('calendar-events', { connection: { url: env.REDIS_URL } });
const contentCyclesQueue = new Queue('content-cycles',  { connection: { url: env.REDIS_URL } });

const drivePoller = new DrivePoller(
  db,
  encProvider,
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  calendarQueue,
  queue,          // incoming-events queue — for CSV build-workbook jobs
  logger,
);

const calendarConsumer = createCalendarConsumer(
  db, encProvider,
  env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET,
  extractScriptPath, env.CAL_PYTHON_BIN,
  logger, env.REDIS_URL,
);

const contentCycleConsumer = createContentCycleConsumer(
  db, encProvider,
  env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET,
  model, prompts, audit, logger, env.REDIS_URL,
  env.APIFY_API_KEY,
  contentCyclesQueue,
);

// Register the daily content-cycle scheduler tick (05:00 Europe/London).
// BullMQ deduplicates if the repeatable job is already registered from a prior startup.
// Zero clients run until content_cycle_enabled is explicitly set true in the DB.
void contentCyclesQueue.add(
  'scheduler-tick',
  { type: 'scheduler-tick' },
  { repeat: { pattern: '0 5 * * *', tz: 'Europe/London' } },
);
logger.info('Content-cycle scheduler tick registered (daily 05:00 Europe/London)');

const consumer = createConsumer(
  db,
  router,
  registry,
  runner,
  dispatcher,
  logger,
  env.REDIS_URL,
  (clientId, externalId) => readStateService.markRead(clientId, externalId),
  queue,
);
logger.info('BullMQ consumer started');

// To activate sprigly-inbox-triage for a mailbox in full mode, run:
//   UPDATE routing_rules
//     SET workflow_id = 'sprigly-inbox-triage'
//   WHERE auto_created = true AND client_id = '<client-uuid>';
// Also ensure a triage_configs row exists for the client.

const poll = async (): Promise<void> => {
  await pollAllClients(db, gmailPoller, queue, logger);
  await drivePoller.pollAllChannels();
  await checkSentDraftsForAllClients(db, encProvider, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, ingestDeps, logger);
};
void poll();
const interval = setInterval(() => { void poll(); }, env.POLL_INTERVAL_MS);
logger.info({ intervalMs: env.POLL_INTERVAL_MS }, 'Polling started');

const DIGEST_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const sendDigests = (): Promise<void> =>
  sendDigestsForAllClients(db, encProvider, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.APP_BASE_URL, logger);
void sendDigests();
const digestInterval = setInterval(() => { void sendDigests(); }, DIGEST_CHECK_INTERVAL_MS);
logger.info({ intervalMs: DIGEST_CHECK_INTERVAL_MS }, 'Digest sender started');

const VOICE_MERGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
// Kill switch: VOICE_MERGE_ENABLED=false pauses the daily merge (it is known to
// erode curated voice.md content). Default enabled, so other clients are unaffected.
let voiceMergeInterval: ReturnType<typeof setInterval> | undefined;
if (env.VOICE_MERGE_ENABLED) {
  const voiceMerge = (): Promise<void> =>
    runVoiceBatchMerge(db, encProvider, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, model, prompts, audit, logger);
  voiceMergeInterval = setInterval(() => { void voiceMerge(); }, VOICE_MERGE_INTERVAL_MS);
  logger.info({ intervalMs: VOICE_MERGE_INTERVAL_MS }, 'Voice batch merge scheduled');
} else {
  logger.warn('Voice batch merge DISABLED (VOICE_MERGE_ENABLED=false) — daily merge will not run');
}

const shutdown = async (): Promise<void> => {
  logger.info('Shutting down...');
  clearInterval(interval);
  clearInterval(digestInterval);
  if (voiceMergeInterval) clearInterval(voiceMergeInterval);
  await consumer.close();
  await calendarConsumer.close();
  await contentCycleConsumer.close();
  await queue.close();
  await calendarQueue.close();
  await contentCyclesQueue.close();
  logger.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled promise rejection — process kept alive');
});
process.on('uncaughtException', (err) => {
  logger.error({ err: String(err), stack: err.stack }, 'Uncaught exception — process kept alive');
});
