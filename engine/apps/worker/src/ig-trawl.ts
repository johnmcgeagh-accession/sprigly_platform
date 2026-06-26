/**
 * ig-trawl.ts — CLI wrapper for the ig-trawl job.
 *
 * Resolves the client slug to a clientId then delegates to runIgTrawlJob,
 * which is the same handler the BullMQ consumer uses.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker ig-trawl <client-slug> <channel> <YYYY-MM>
 *
 * Requires APIFY_API_KEY in env (.env.local, loaded by the package.json script).
 */

import pino from 'pino';
import { eq } from 'drizzle-orm';
import { db, clients } from '@sprigly/db';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { env } from './env.js';
import { runIgTrawlJob } from './ig-producer.js';

const slug    = process.argv[2];
const channel = process.argv[3];
const month   = process.argv[4];

if (!slug || !channel || !month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error('Usage: pnpm --filter @sprigly/worker ig-trawl <slug> <channel> <YYYY-MM>');
  console.error('  e.g. pnpm --filter @sprigly/worker ig-trawl ivy-t instagram 2026-05');
  process.exit(1);
}

const logger = pino({ name: 'ig-trawl', level: 'info' });

const clientRows = await db
  .select({ id: clients.id })
  .from(clients)
  .where(eq(clients.slug, slug))
  .limit(1);

const clientRow = clientRows[0];
if (!clientRow) { console.error(`Client not found: ${slug}`); process.exit(1); }

const encProvider = createEncryptionProvider();

await runIgTrawlJob(clientRow.id, channel, month, {
  db,
  encProvider,
  googleClientId:     env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  apifyApiKey:        env.APIFY_API_KEY,
  logger,
});
