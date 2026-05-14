import { db as _db, oauthConnections, incomingEvents } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { GmailPoller } from '@sprigly/sources';
import { Queue } from 'bullmq';
import type { Logger } from 'pino';

type Db = typeof _db;

export async function pollAllClients(
  db: Db,
  poller: GmailPoller,
  queue: Queue,
  logger: Logger,
): Promise<void> {
  const connections = await db
    .select({ clientId: oauthConnections.clientId })
    .from(oauthConnections)
    .where(and(eq(oauthConnections.provider, 'gmail'), eq(oauthConnections.status, 'active')));

  for (const { clientId } of connections) {
    try {
      const count = await poller.poll(clientId);
      if (count === 0) continue;

      const events = await db
        .select({ id: incomingEvents.id })
        .from(incomingEvents)
        .where(and(eq(incomingEvents.clientId, clientId), eq(incomingEvents.status, 'received')));

      for (const { id: eventId } of events) {
        await queue.add('process', { eventId, clientId }, { jobId: eventId });
      }

      logger.info({ clientId, count, queued: events.length }, 'polled');
    } catch (err) {
      logger.error({ clientId, err: String(err) }, 'poll failed');
    }
  }
}
