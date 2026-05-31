import { env } from './env.js';
import pino from 'pino';
import { db } from '@sprigly/db';
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
import {
  spriglyBlogPostWorkflow,
  spriglyProspectResearchWorkflow,
  spriglyInboxNoopWorkflow,
  spriglyInboxTriageWorkflow,
  spriglyQuestionAnswererWorkflow,
} from '@sprigly/workflows';
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
logger.info(
  { workflows: ['sprigly-blog-post', 'sprigly-prospect-research', 'sprigly-inbox-noop', 'sprigly-inbox-triage', 'sprigly-question-answerer'] },
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

const queue = new Queue('incoming-events', { connection: { url: env.REDIS_URL } });

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

const shutdown = async (): Promise<void> => {
  logger.info('Shutting down...');
  clearInterval(interval);
  clearInterval(digestInterval);
  await consumer.close();
  await queue.close();
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
