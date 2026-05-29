import {
  db as _db,
  workflowRuns,
  incomingEvents,
  clientConfigs,
  triageConfigs,
  triageCaptureLog,
  triageSeenMessages,
} from '@sprigly/db';
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
  WebSearchProvider,
  TriageConfig,
  TriageCategory,
  ReplyExample,
  TriageStore,
  WorkflowOutcome,
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

class DbTriageStore implements TriageStore {
  constructor(private db: Db) {}

  async writeSeenMessage(params: {
    clientId: string;
    messageId: string;
    threadId: string;
    outcome: WorkflowOutcome;
  }): Promise<void> {
    await this.db
      .insert(triageSeenMessages)
      .values({
        clientId: params.clientId,
        messageId: params.messageId,
        threadId: params.threadId,
        outcome: params.outcome,
      })
      .onConflictDoNothing();
  }

  async writeCaptureLogDraft(params: {
    clientId: string;
    eventId: string;
    workflowRunId: string;
    category: string;
    suggestedAction: string;
    draftText?: string;
    escalationReason?: string;
  }): Promise<string> {
    const [row] = await this.db
      .insert(triageCaptureLog)
      .values({
        clientId: params.clientId,
        eventId: params.eventId,
        workflowRunId: params.workflowRunId,
        category: params.category,
        suggestedAction: params.suggestedAction,
        draftText: params.draftText ?? null,
        escalationReason: params.escalationReason ?? null,
      })
      .returning({ id: triageCaptureLog.id });

    if (row === undefined) throw new Error('Failed to insert triage_capture_log row');
    return row.id;
  }
}

interface GmailDraftOps {
  createDraft(clientId: string, params: {
    threadId?: string;
    to: string;
    subject: string;
    bodyText: string;
    inReplyToMessageId?: string;
  }): Promise<string | null>;
}

export class WorkflowRunner {
  constructor(
    private db: Db,
    private registry: WorkflowRegistry,
    private model: ModelClient,
    private audit: AuditLogger,
    private prompts: PromptResolver,
    private search?: WebSearchProvider,
    private gmailDraftService?: GmailDraftOps,
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
    {
      const configRows = rule.clientConfigId !== ''
        ? await this.db.select().from(clientConfigs).where(eq(clientConfigs.id, rule.clientConfigId)).limit(1)
        : await this.db.select().from(clientConfigs).where(eq(clientConfigs.clientId, dbEvent.clientId)).limit(1);
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

    // Load triage-specific context when the workflow requires it.
    let triageConfig: TriageConfig | undefined;
    let triageStore: TriageStore | undefined;

    if (rule.workflowId === 'sprigly-inbox-triage') {
      const triageRows = await this.db
        .select()
        .from(triageConfigs)
        .where(eq(triageConfigs.clientId, dbEvent.clientId))
        .limit(1);

      if (triageRows[0] === undefined) {
        const error = `No triage_config found for client: ${dbEvent.clientId} — create one via the admin UI or seed migration`;
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

      const row = triageRows[0];
      triageConfig = {
        categories: (row.categories as Array<Record<string, unknown>>) as unknown as TriageCategory[],
        voiceSample: row.voiceSample,
        replyExamples: (row.replyExamples as Array<Record<string, unknown>>) as unknown as ReplyExample[],
        ...(row.additionalInstructions !== null && { additionalInstructions: row.additionalInstructions }),
      };
      triageStore = new DbTriageStore(this.db);
    }

    const ctx: WorkflowContext = {
      clientId: dbEvent.clientId,
      clientConfig,
      model: this.model,
      audit: this.audit,
      prompts: this.prompts,
      eventId: dbEventId,
      runId,
      ...(this.search !== undefined && { search: this.search }),
      ...(triageConfig !== undefined && { triageConfig }),
      ...(triageStore !== undefined && { triageStore }),
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
      const outcome = ((output as { outcome?: string }).outcome ?? 'handled') as WorkflowOutcome;
      await this.db
        .update(workflowRuns)
        .set({
          status: 'completed',
          endedAt: new Date(),
          output: stripBuffers(output) as Record<string, unknown>,
          outcome,
        })
        .where(eq(workflowRuns.id, runId));
      await this.db
        .update(incomingEvents)
        .set({ status: 'completed' })
        .where(eq(incomingEvents.id, dbEventId));

      // For triage draft_reply items: create a Gmail draft in the correct thread.
      // Failure here must not unwind the run — the capture log row is already written.
      if (
        rule.workflowId === 'sprigly-inbox-triage' &&
        this.gmailDraftService !== undefined
      ) {
        const o = output as { action?: string; draftText?: string; captureLogId?: string };
        if (o.action === 'draft_reply' && o.draftText && o.captureLogId) {
          try {
            const meta = dbEvent.sourceMetadata as Record<string, unknown>;
            const from        = typeof meta['from']         === 'string' ? meta['from']         : '';
            const subject     = typeof meta['subject']      === 'string' ? meta['subject']      : '';
            const threadId    = typeof meta['threadId']     === 'string' ? meta['threadId']     : undefined;
            const rfcMessageId = typeof meta['rfcMessageId'] === 'string' ? meta['rfcMessageId'] : undefined;
            const replySubj   = subject.startsWith('Re: ') ? subject : `Re: ${subject}`;

            const draftId = await this.gmailDraftService.createDraft(dbEvent.clientId, {
              to: from,
              subject: replySubj,
              bodyText: o.draftText,
              ...(threadId     !== undefined && { threadId }),
              ...(rfcMessageId !== undefined && { inReplyToMessageId: rfcMessageId }),
            });

            if (draftId !== null) {
              await this.db
                .update(triageCaptureLog)
                .set({ gmailDraftId: draftId, updatedAt: new Date() })
                .where(eq(triageCaptureLog.id, o.captureLogId));
            }
          } catch { /* draft failure must not fail the run */ }
        }
      }

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
