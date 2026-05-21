import { env } from './env.js';
import pino from 'pino';
import { db } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
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
} from '@sprigly/workflows';
import { TavilyProvider } from '@sprigly/web-search';
import { GmailPoller, createGmailReadStateService } from '@sprigly/sources';
import {
  DbSaveBlogPost,
  DbSaveOutput,
  GmailSendNotification,
  GmailReplyWithAttachment,
} from '@sprigly/destinations';
import { Queue } from 'bullmq';
import { pollAllClients } from './poller.js';
import { createConsumer } from './consumer.js';

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

const registry = new WorkflowRegistry();
registry.register(spriglyBlogPostWorkflow);
registry.register(spriglyProspectResearchWorkflow);
registry.register(spriglyInboxNoopWorkflow);
registry.register(spriglyInboxTriageWorkflow);
logger.info(
  { workflows: ['sprigly-blog-post', 'sprigly-prospect-research', 'sprigly-inbox-noop', 'sprigly-inbox-triage'] },
  'Registered workflows',
);

const router = new EventRouter(db);
const search = new TavilyProvider();
const runner = new WorkflowRunner(db, registry, model, audit, prompts, search);

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
);
logger.info('BullMQ consumer started');

// To activate sprigly-inbox-triage for a mailbox in full mode, run:
//   UPDATE routing_rules
//     SET workflow_id = 'sprigly-inbox-triage'
//   WHERE auto_created = true AND client_id = '<client-uuid>';
// Also ensure a triage_configs row exists for the client.

const poll = (): Promise<void> => pollAllClients(db, gmailPoller, queue, logger);
void poll();
const interval = setInterval(() => { void poll(); }, env.POLL_INTERVAL_MS);
logger.info({ intervalMs: env.POLL_INTERVAL_MS }, 'Polling started');

const shutdown = async (): Promise<void> => {
  logger.info('Shutting down...');
  clearInterval(interval);
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
