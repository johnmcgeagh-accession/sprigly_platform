/**
 * consumer.ts — BullMQ worker for the 'content-cycles' queue.
 *
 * Job types:
 *   extract-voice: runs extractVoiceDeltasForCycle (active → awaiting_voice_approval)
 *   apply-voice:   runs applyVoiceDeltasForCycle (approval → voice_merged → closed)
 *
 * Enqueue via contentCyclesQueue.add(type, { type, cycleId }, { jobId: ... }).
 */

import { Worker } from 'bullmq';
import { db as _db } from '@sprigly/db';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DbPromptResolver } from '@sprigly/prompts';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { Logger } from 'pino';
import { extractVoiceDeltasForCycle } from './extract.js';
import { applyVoiceDeltasForCycle } from './apply.js';

type Db = typeof _db;

interface ContentCycleJob {
  type:    'extract-voice' | 'apply-voice';
  cycleId: string;
}

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
): Worker {
  return new Worker(
    'content-cycles',
    async (job) => {
      const { type, cycleId } = job.data as ContentCycleJob;
      const logCtx = { type, cycleId, jobId: job.id };

      switch (type) {
        case 'extract-voice':
          logger.info(logCtx, 'content-cycles: starting extract-voice job');
          await extractVoiceDeltasForCycle(
            cycleId, db, encProvider,
            googleClientId, googleClientSecret,
            model, prompts, audit, logger,
          );
          break;

        case 'apply-voice':
          logger.info(logCtx, 'content-cycles: starting apply-voice job');
          await applyVoiceDeltasForCycle(
            cycleId, db, encProvider,
            googleClientId, googleClientSecret,
            audit, logger,
          );
          break;

        default:
          logger.warn(logCtx, 'content-cycles: unknown job type — skipped');
      }
    },
    { connection: { url: redisUrl }, concurrency: 2 },
  );
}
