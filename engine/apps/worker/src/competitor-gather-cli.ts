/**
 * competitor-gather-cli.ts — CLI wrapper for the competitor gather job.
 *
 * Resolves the client slug to a clientId then runs gatherCompetitorData,
 * the same function the BullMQ consumer (Stage 3) will call.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker competitor-gather <client-slug> <channel>
 *
 * Requires APIFY_API_KEY in env (.env.local, loaded by the package.json script).
 */

import pino from 'pino';
import { eq } from 'drizzle-orm';
import { db, clients } from '@sprigly/db';
import { env } from './env.js';
import { gatherCompetitorData } from './competitor-gather.js';

const slug    = process.argv[2];
const channel = process.argv[3];

if (!slug || !channel) {
  console.error('Usage: pnpm --filter @sprigly/worker competitor-gather <slug> <channel>');
  console.error('  e.g. pnpm --filter @sprigly/worker competitor-gather ivy-t instagram');
  process.exit(1);
}

const logger = pino({ name: 'competitor-gather', level: 'info' });

const clientRows = await db
  .select({ id: clients.id })
  .from(clients)
  .where(eq(clients.slug, slug))
  .limit(1);

const clientRow = clientRows[0];
if (!clientRow) { console.error(`Client not found: ${slug}`); process.exit(1); }

const result = await gatherCompetitorData(clientRow.id, channel, {
  db,
  apifyApiKey: env.APIFY_API_KEY,
  logger,
});

logger.info(result, 'competitor-gather-cli: done');
