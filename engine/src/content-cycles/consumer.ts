/**
 * consumer.ts — BullMQ worker for the 'content-cycles' queue.
 *
 * Job types:
 *   extract-voice:   runs extractVoiceDeltasForCycle (active → awaiting_voice_approval)
 *   apply-voice:     runs applyVoiceDeltasForCycle (approval → voice_merged → closed)
 *   ig-trawl:        runs runIgTrawlJob then CHAINS to request-email on success
 *   request-email:   runs requestEmailStub (scheduled → requested)
 *   scheduler-tick:  daily cron tick — queries enabled clients and enqueues ig-trawl for due ones
 *
 * Chaining: ig-trawl → request-email is triggered on job SUCCESS (no thrown error),
 * regardless of whether a Drive file was written. A trawl that succeeds but produces
 * no IG file (no APIFY_API_KEY, zero owned posts) is still success — request-email
 * then degrades to sales-only via the existing null-engagement path in lean-line.ts.
 * Only a thrown error stops the chain, causing BullMQ to retry the trawl.
 *
 * Retry policies (set as job options when enqueueing):
 *   IG_TRAWL_JOB_OPTIONS      — aggressive: 5 attempts, exponential backoff (Apify is network-flaky)
 *   REQUEST_EMAIL_JOB_OPTIONS — gentler:   3 attempts, fixed 15 s delay
 *
 * Idempotency across the chain:
 *   trawl:         overwrites the Drive file on re-run (existing behaviour)
 *   request-email: early-returns if cycle.status === 'requested' (existing guard in runRequestEmail)
 *   chain re-run:  trawl refreshes the file, enqueues email with a deterministic jobId so
 *                  BullMQ deduplicates pending jobs; if the email already ran, it no-ops.
 *
 * Enqueue via contentCyclesQueue.add(type, { type, ... }, { ...JOB_OPTIONS, jobId: ... }).
 */

import { Worker, type Queue } from 'bullmq';
import { db as _db } from '@sprigly/db';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DbPromptResolver } from '@sprigly/prompts';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { Logger } from 'pino';
import { extractVoiceDeltasForCycle } from './extract.js';
import { applyVoiceDeltasForCycle } from './apply.js';
import { runPlanningForCycle, ensureAppLink } from './planning.js';
import { deliverTemplatedEmail } from './email-send.js';
import { runShapeForCycle, type ShapeJob } from './shape.js';
import { runHookForPost, type HookJob } from './hook.js';
import { runScriptForPost, type ScriptJob } from './script.js';
import { runWeeklySession, type WeeklySessionJob } from './weekly-session.js';
import { runWeeklySessionTick } from './weekly-cron.js';
import { runIgTrawlJob } from '../ig-producer.js';
import { requestEmailStub } from './stubs.js';
import { runContentCycleTick } from './scheduler.js';
import {
  IG_TRAWL_JOB_OPTIONS,
  REQUEST_EMAIL_JOB_OPTIONS,
  igTrawlJobId,
  requestEmailJobId,
} from './job-options.js';

// Re-export so callers that previously imported from consumer.ts continue to work.
export { IG_TRAWL_JOB_OPTIONS, REQUEST_EMAIL_JOB_OPTIONS, igTrawlJobId, requestEmailJobId };

type Db = typeof _db;

// ── Job type union ────────────────────────────────────────────────────────────

type ContentCycleJob =
  | { type: 'extract-voice';   cycleId: string }
  | { type: 'apply-voice';     cycleId: string }
  | { type: 'planning';        cycleId: string }
  | { type: 'ig-trawl';        clientId: string; channel: string; dataMonth: string }
  | { type: 'request-email';   clientId: string; channel: string; dataMonth: string }
  | { type: 'scheduler-tick' }
  | { type: 'weekly-session-tick' }
  | WeeklySessionJob
  | ShapeJob
  | HookJob
  | ScriptJob;

export function createContentCycleConsumer(
  db:                 Db,
  encProvider:        EncryptionProvider,
  googleClientId:     string,
  googleClientSecret: string,
  model:              ModelClient,
  prompts:            DbPromptResolver,
  audit:              AuditLogger,
  logger:             Logger,
  redisUrl:           string,
  apifyApiKey:        string | undefined,
  queue:              Queue,
): Worker {
  return new Worker(
    'content-cycles',
    async (job) => {
      const data   = job.data as ContentCycleJob;
      const logCtx = { type: data.type, jobId: job.id };

      switch (data.type) {
        case 'extract-voice':
          logger.info({ ...logCtx, cycleId: data.cycleId }, 'content-cycles: starting extract-voice job');
          await extractVoiceDeltasForCycle(
            data.cycleId, db, encProvider,
            googleClientId, googleClientSecret,
            model, prompts, audit, logger,
          );
          break;

        case 'apply-voice':
          logger.info({ ...logCtx, cycleId: data.cycleId }, 'content-cycles: starting apply-voice job');
          await applyVoiceDeltasForCycle(
            data.cycleId, db, encProvider,
            googleClientId, googleClientSecret,
            audit, logger,
          );
          break;

        case 'planning':
          logger.info({ ...logCtx, cycleId: data.cycleId }, 'content-cycles: starting planning job');
          await runPlanningForCycle(data.cycleId, {
            db, encProvider, googleClientId, googleClientSecret,
            model, prompts, audit, logger,
          });
          break;

        case 'shape': {
          const shapeDeps = { db, encProvider, googleClientId, googleClientSecret, model, prompts, audit, logger };
          // hook / script refine reuses the shape job (same jobId + poll), dispatched to the
          // lighter minimal-edit path; caption keeps the full generate+validate machinery (§26).
          if (data.target === 'hook' || data.target === 'script') {
            logger.info({ ...logCtx, cycleId: data.cycleId, postId: data.targetPostId, target: data.target }, 'content-cycles: starting refine job');
            const { runFieldRefine } = await import('./refine.js');
            return await runFieldRefine(data, shapeDeps);
          }
          logger.info({ ...logCtx, cycleId: data.cycleId, postId: data.targetPostId, scope: data.scope }, 'content-cycles: starting shape job');
          // Return the result so BullMQ sets job.returnvalue (read by GET /api/jobs/:id).
          return await runShapeForCycle(data, shapeDeps);
        }

        case 'hook':
          logger.info({ ...logCtx, cycleId: data.cycleId, postId: data.targetPostId }, 'content-cycles: starting hook job');
          // Returns { candidates } → BullMQ job.returnvalue → read by GET /api/jobs/:id.
          return await runHookForPost(data, {
            db, encProvider, googleClientId, googleClientSecret,
            model, prompts, audit, logger,
          });

        case 'script':
          logger.info({ ...logCtx, cycleId: data.cycleId, postId: data.targetPostId }, 'content-cycles: starting script job');
          return await runScriptForPost(data, {
            db, encProvider, googleClientId, googleClientSecret,
            model, prompts, audit, logger,
          });

        case 'ig-trawl': {
          const { clientId, channel, dataMonth } = data;
          logger.info({ ...logCtx, clientId, channel, dataMonth }, 'content-cycles: starting ig-trawl job');
          await runIgTrawlJob(clientId, channel, dataMonth, {
            db, encProvider, googleClientId, googleClientSecret, apifyApiKey, logger,
          });
          // Chain: enqueue request-email unconditionally on success.
          // "No file written" (missing APIFY_API_KEY, zero owned posts, zero month posts) is
          // NOT an error — runIgTrawlJob returns void. The email then degrades to sales-only.
          // Only a thrown error above stops the chain.
          const emailJobId = requestEmailJobId(clientId, channel, dataMonth);

          // BullMQ silently deduplicates queue.add() against jobs already in the
          // completed set — queue.add() returns without error and without enqueuing.
          // Clear any completed/failed entry before chaining so the email actually runs.
          // This protects both the scheduler path and the UI-trigger path.
          // active/waiting entries are left in place — they're already running or pending.
          const existingEmail = await queue.getJob(emailJobId);
          if (existingEmail) {
            const emailState = await existingEmail.getState();
            if (emailState === 'completed' || emailState === 'failed' || emailState === 'unknown') {
              try { await existingEmail.remove(); } catch { /* best-effort */ }
            }
          }

          await queue.add(
            'request-email',
            { type: 'request-email', clientId, channel, dataMonth },
            { ...REQUEST_EMAIL_JOB_OPTIONS, jobId: emailJobId },
          );
          logger.info({ ...logCtx, clientId, channel, dataMonth, emailJobId },
            'content-cycles: ig-trawl done — chained request-email job');
          break;
        }

        case 'request-email':
          logger.info({ ...logCtx, clientId: data.clientId, channel: data.channel, dataMonth: data.dataMonth },
            'content-cycles: starting request-email job');
          await requestEmailStub(data.clientId, data.channel, data.dataMonth);
          break;

        case 'scheduler-tick': {
          logger.info(logCtx, 'content-cycles: starting scheduler-tick job');
          // Real Gmail/planning deps live here — wire the three-touch reminder sender and the
          // app-link resolver (all sends pinned to the test inbox). The auto-run notify hook is
          // deliberately NOT wired: on a real auto-run the trigger-time signal is the log-only
          // [auto-run:kicked] line, and the completion-path plan_ready email is the observation.
          const emailDeps = { db, encProvider, googleClientId, googleClientSecret, logger };
          const sendEmail = (input: { key: 'ask' | 'nudge' | 'last_call' | 'plan_ready'; clientId: string; merge: Record<string, string> }) =>
            deliverTemplatedEmail(emailDeps, input);
          const resolveAppLink = (clientId: string, cycleId: string) =>
            ensureAppLink(db, clientId, cycleId, process.env['APP_BASE_URL'] ?? '', logger);
          await runContentCycleTick({ db, queue, logger, sendEmail, resolveAppLink });
          break;
        }

        case 'weekly-session':
          logger.info({ ...logCtx, clientId: data.clientId, cycleId: data.cycleId, weekStart: data.weekStart }, 'content-cycles: starting weekly-session job');
          return await runWeeklySession(data, {
            db, encProvider, googleClientId, googleClientSecret,
            model, prompts, audit, logger,
          });

        case 'weekly-session-tick':
          logger.info(logCtx, 'content-cycles: starting weekly-session-tick job');
          await runWeeklySessionTick({ db, queue, logger });
          break;

        default:
          logger.warn(logCtx, 'content-cycles: unknown job type — skipped');
      }
    },
    { connection: { url: redisUrl }, concurrency: 2 },
  );
}
