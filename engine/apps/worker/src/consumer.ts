import { db as _db, incomingEvents, workflowRuns } from '@sprigly/db';

function extractApiErrorMeta(err: Error): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  // Anthropic SDK / Bedrock SDK error shapes
  const e = err as unknown as Record<string, unknown>;
  if (typeof e['status'] === 'number')   meta['statusCode'] = e['status'];
  if (typeof e['error'] === 'object' && e['error'] !== null) meta['apiError'] = e['error'];
  if (typeof e['request_id'] === 'string') meta['requestId'] = e['request_id'];
  // AWS SDK error shape
  if (typeof e['$metadata'] === 'object' && e['$metadata'] !== null) {
    const md = e['$metadata'] as Record<string, unknown>;
    meta['statusCode'] = md['httpStatusCode'];
    meta['requestId'] = md['requestId'];
  }
  return meta;
}
import type { IncomingEvent as DbIncomingEvent } from '@sprigly/db';
import { eq, and, desc } from 'drizzle-orm';
import { Worker as BullWorker } from 'bullmq';
import type {
  EventRouter,
  WorkflowRunner,
  DestinationDispatcher,
  WorkflowRegistry,
  RoutingRule,
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
  _registry: WorkflowRegistry,
  runner: WorkflowRunner,
  dispatcher: DestinationDispatcher,
  logger: Logger,
  redisUrl: string,
  markRead: (clientId: string, externalId: string) => Promise<void>,
): BullWorker {
  return new BullWorker(
    'incoming-events',
    async (job) => {
      const { eventId, directWorkflowId } = job.data as { eventId: string; clientId: string; directWorkflowId?: string };

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

        // directWorkflowId bypasses routing — used when the review page explicitly
        // triggers a workflow (e.g. approving an invoke_workflow triage item).
        let rules: RoutingRule[];
        if (directWorkflowId !== undefined) {
          rules = [{
            id: `direct-${eventId}`,
            clientId: event.clientId,
            enabled: true,
            match: { source: event.source, conditions: [] },
            workflowId: directWorkflowId,
            destinations: [],
            clientConfigId: '',
            priority: 0,
            isFallback: false,
          }];
        } else {
          rules = await router.route(event);
        }

        if (rules.length === 0) {
          await db
            .update(incomingEvents)
            .set({ status: 'ignored' })
            .where(eq(incomingEvents.id, eventId));
          logger.warn({ eventId }, 'no matching rules');
          return;
        }

        // Track whether ANY matched rule produced a needs_human or deferred
        // outcome. Only if ALL runs complete successfully and none are
        // needs_human/deferred do we mark the email as read.
        // Note: if runner.run() throws, the catch block below rethrows before
        // we ever reach the markRead call — failed runs always stay unread.
        let shouldMarkRead = true;

        for (const rule of rules) {
          const output = await runner.run(rule, eventId);
          if (output === null) continue;

          const outcome = (output as { outcome?: string }).outcome;
          if (outcome === 'needs_human' || outcome === 'deferred') {
            shouldMarkRead = false;
          }

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

        // Mark as read only after all rules are processed and no run was
        // needs_human or deferred. Absent outcome (legacy workflows) defaults
        // to handled — they are marked read as before.
        if (shouldMarkRead && dbEvent.externalId !== null && dbEvent.externalId !== undefined) {
          await markRead(dbEvent.clientId, dbEvent.externalId);
        }
      } catch (err) {
        // Log full error details before re-throwing.
        // Re-throwing lets BullMQ mark the job as FAILED; it does NOT crash the worker.
        // A failed job leaves the email unread — the failure is visible in the admin UI.
        const detail = err instanceof Error
          ? { message: err.message, stack: err.stack, ...extractApiErrorMeta(err) }
          : { raw: String(err) };
        logger.error({ eventId, ...detail }, 'job failed');
        throw err;
      }
    },
    { connection: { url: redisUrl }, concurrency: 10 },
  );
}
