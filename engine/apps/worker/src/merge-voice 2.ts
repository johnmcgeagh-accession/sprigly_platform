/**
 * merge-voice.ts — manual trigger for the voice batch merge.
 *
 * Runs the same logic as the daily cron but immediately.
 * Usage: pnpm merge-voice
 */

import { db } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createAuditLogger } from '@sprigly/audit';
import { DbPromptResolver } from '@sprigly/prompts';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import pino from 'pino';
import { runVoiceBatchMerge } from './voice-batch-merge.js';

const logger = pino({ level: 'info' });

const googleClientId     = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];

if (!googleClientId || !googleClientSecret) {
  console.error('Missing required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
  process.exit(1);
}

const model       = createModelClientFromEnv();
const audit       = createAuditLogger(db);
const prompts     = new DbPromptResolver(db);
const encProvider = createEncryptionProvider();

await runVoiceBatchMerge(
  db, encProvider,
  googleClientId, googleClientSecret,
  model, prompts, audit, logger,
);
