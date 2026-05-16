import { db as _db, workflowRuns, incomingEvents, clientConfigs } from '@sprigly/db';
import { stripBuffers } from './strip-buffers.js';
import type { IncomingEvent as DbIncomingEvent } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import type {
  IncomingEvent,
  RoutingRule,
  WorkflowContext,
  ClientConfig,
  ModelClient,
  AuditLogger,
  PromptResolver,
  SourceType,
} from './types.js';
import type { WorkflowRegistry } from './workflow-registry.js';

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

const defaultClientConfig = (clientId: string): ClientConfig => ({
  id: '',
  clientId,
  brandVoice: '',
  signature: '',
  authorName: '',
  settings: {},
});

export class WorkflowRunner {
  constructor(
    private db: Db,
    private registry: WorkflowRegistry,
    private model: ModelClient,
    private audit: AuditLogger,
    private prompts: PromptResolver,
  ) {}

  async run(rule: RoutingRule, dbEventId: string): Promise<unknown> {
    const eventRows = await this.db
      .select()
      .from(incomingEvents)
      .where(eq(incomingEvents.id, dbEventId))
      .limit(1);

    const dbEvent = eventRows[0];
    if (dbEvent === undefined) {
      throw new Error(`incoming_events row not found: ${dbEventId}`);
    }

    const [runRow] = await this.db
      .insert(workflowRuns)
      .values({
        eventId: dbEventId,
        clientId: dbEvent.clientId,
        workflowId: rule.workflowId,
        status: 'running',
        startedAt: new Date(),
      })
      .returning({ id: workflowRuns.id });

    const runId = runRow?.id;
    if (runId === undefined) throw new Error('Failed to insert workflow_run row');

    await this.db
      .update(incomingEvents)
      .set({ status: 'running' })
      .where(eq(incomingEvents.id, dbEventId));

    const workflow = this.registry.get(rule.workflowId);
    if (workflow === undefined) {
      const error = `Workflow not registered: ${rule.workflowId}`;
      await this.db
        .update(workflowRuns)
        .set({ status: 'failed', endedAt: new Date(), error })
        .where(eq(workflowRuns.id, runId));
      await this.db
        .update(incomingEvents)
        .set({ status: 'failed' })
        .where(eq(incomingEvents.id, dbEventId));
      throw new Error(error);
    }

    const event = toEngineEvent(dbEvent);

    let clientConfig: ClientConfig = defaultClientConfig(dbEvent.clientId);
    if (rule.clientConfigId !== '') {
      const configRows = await this.db
        .select()
        .from(clientConfigs)
        .where(eq(clientConfigs.id, rule.clientConfigId))
        .limit(1);
      if (configRows[0] !== undefined) {
        const row = configRows[0];
        clientConfig = {
          id: row.id,
          clientId: row.clientId,
          brandVoice: row.brandVoice ?? '',
          signature: row.signature ?? '',
          authorName: row.authorName ?? '',
          settings: row.settings,
        };
      }
    }

    const ctx: WorkflowContext = {
      clientId: dbEvent.clientId,
      clientConfig,
      model: this.model,
      audit: this.audit,
      prompts: this.prompts,
      eventId: dbEventId,
      runId,
    };

    const input = workflow.parseInput(event);
    if (input === null) {
      await this.db
        .update(workflowRuns)
        .set({ status: 'completed', endedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
      await this.db
        .update(incomingEvents)
        .set({ status: 'ignored' })
        .where(eq(incomingEvents.id, dbEventId));
      return null;
    }

    try {
      const output = await workflow.run(input, ctx);
      await this.db
        .update(workflowRuns)
        .set({ status: 'completed', endedAt: new Date(), output: stripBuffers(output) as Record<string, unknown> })
        .where(eq(workflowRuns.id, runId));
      await this.db
        .update(incomingEvents)
        .set({ status: 'completed' })
        .where(eq(incomingEvents.id, dbEventId));
      return output;
    } catch (err) {
      const error = String(err);
      await this.db
        .update(workflowRuns)
        .set({ status: 'failed', endedAt: new Date(), error })
        .where(eq(workflowRuns.id, runId));
      await this.db
        .update(incomingEvents)
        .set({ status: 'failed' })
        .where(eq(incomingEvents.id, dbEventId));
      throw err;
    }
  }
}
