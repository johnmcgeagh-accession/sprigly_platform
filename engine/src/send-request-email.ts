/**
 * send-request-email.ts — manually trigger the request-email worker for one
 * client/channel/month. Seeds a 'scheduled' cycle if one doesn't exist yet.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker send-request-email <slug> <channel> <YYYY-MM>
 */

import { db, clients, contentCycles } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import pino from 'pino';
import { requestEmailStub } from './content-cycles/stubs.js';

const logger = pino({ name: 'send-request-email' });

const slug    = process.argv[2];
const channel = process.argv[3];
const month   = process.argv[4];

if (!slug || !channel || !month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error('Usage: pnpm send-request-email <slug> <channel> <YYYY-MM>');
  process.exit(1);
}

const clientRows = await db
  .select({ id: clients.id, name: clients.name })
  .from(clients)
  .where(eq(clients.slug, slug))
  .limit(1);

const client = clientRows[0];
if (!client) { console.error(`Client not found: ${slug}`); process.exit(1); }

logger.info({ clientId: client.id, clientName: client.name, channel, month }, 'send-request-email: resolved client');

const existingRows = await db
  .select({ id: contentCycles.id, status: contentCycles.status })
  .from(contentCycles)
  .where(and(
    eq(contentCycles.clientId,   client.id),
    eq(contentCycles.channel,    channel),
    eq(contentCycles.cycleMonth, month),
  ))
  .limit(1);

if (!existingRows[0]) {
  await db.insert(contentCycles).values({
    clientId:   client.id,
    channel,
    cycleMonth: month,
    status:     'scheduled',
  });
  logger.info({ clientId: client.id, channel, month }, 'send-request-email: seeded new scheduled cycle');
} else {
  logger.info(
    { cycleId: existingRows[0].id, status: existingRows[0].status },
    'send-request-email: found existing cycle',
  );
}

await requestEmailStub(client.id, channel, month);
logger.info({ clientId: client.id, channel, month }, 'send-request-email: done');
