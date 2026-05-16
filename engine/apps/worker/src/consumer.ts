import { db as _db, incomingEvents, workflowRuns } from '@sprigly/db';
import type { IncomingEvent as DbIncomingEvent } from '@sprigly/db';
import { eq, and, desc } from 'drizzle-orm';
import { Worker as BullWorker } from 'bullmq';
import type {
  EventRouter,
  WorkflowRunner,
  DestinationDispatcher,
  WorkflowRegistry,
  SourceType,
  IncomingEvent,
} from '@sprigly/engine';
import type { Logger } from 'pino';

type Db = typeof _db;

function toEngineEvent(row: DbIncomingEvent): IncomingEvent {
  const content = row.content as { text?: string; structured?: Record<string, unknown> };
  const structured = content['structured'] as Record<string, unknown> | undefined;
  return {
    id: row.id,
    clientId: row.clientId,
    source: row.source as SourceType,
    sourceMetadata: row.sourceMetadata,
    receivedAt: row.receivedAt,
    content: {
      text: (content['text'] as string | undefined) ?? '',
      ...(structured !== undefined && { structured }),
    },
    reply: {
      channel: row.source as SourceType,
      data: row.sourceMetadata,
    },
  };
}

export function createConsumer(
  db: Db,
  router: EventRouter,
  _registry: WorkflowRegistry, // used for defaultDestinations lookup
  runner: WorkflowRunner,
  dispatcher: DestinationDispatcher,
  logger: Logger,
  redisUrl: string,
): BullWorker {
  return new BullWorker(
    'incoming-events',
    async (job) => {
      const { eventId } = job.data as { eventId: string; clientId: string };

      try {
        const rows = await db
          .select()
          .from(incomingEvents)
          .where(eq(incomingEvents.id, eventId))
          .limit(1);

        const dbEvent = rows[0];
        if (dbEvent === undefined) {
          logger.warn({ eventId }, 'event not found');
          return;
        }

        const event = toEngineEvent(dbEvent);
        const rules = await router.route(event);

        if (rules.length === 0) {
          await db
            .update(incomingEvents)
            .set({ status: 'ignored' })
            .where(eq(incomingEvents.id, eventId));
          // Safety net: should be rare post-refactor (rule disabled between poll and process)
          logger.warn({ eventId }, 'no matching rules');
          return;
        }

        for (const rule of rules) {
          const output = await runner.run(rule, eventId);
          if (output === null) continue;

          const runRows = await db
            .select({ id: workflowRuns.id })
            .from(workflowRuns)
            .where(
              and(
                eq(workflowRuns.eventId, eventId),
                eq(workflowRuns.workflowId, rule.workflowId),
              ),
            )
            .orderBy(desc(workflowRuns.startedAt))
            .limit(1);

          const runId = runRows[0]?.id ?? '';
          const workflow = _registry.get(rule.workflowId);
          await dispatcher.dispatch(output, event, rule, runId, workflow?.defaultDestinations);
          logger.info({ eventId, workflowId: rule.workflowId }, 'dispatched');
        }
      } catch (err) {
        logger.error({ eventId, err: String(err) }, 'job failed');
        throw err;
      }
    },
    { connection: { url: redisUrl }, concurrency: 1 },
  );
}
