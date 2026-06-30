import { db as _db, auditLog } from '@sprigly/db';
import type { AuditLogger, LogModelCallParams } from './types.js';
import { computeCostPence } from './price-map.js';

type Db = typeof _db;

export class DrizzleAuditLogger implements AuditLogger {
  constructor(private db: Db) {}

  async logModelCall(params: LogModelCallParams): Promise<void> {
    await this.db.insert(auditLog).values({
      clientId: params.clientId,
      eventId: params.eventId ?? null,
      workflowRunId: params.runId ?? null,
      action: params.action ?? 'model_call',
      modelId: params.modelId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costPence: computeCostPence(params.modelId, params.inputTokens, params.outputTokens),
      metadata: params.metadata ?? {},
    });
  }
}

export function createAuditLogger(db: Db): AuditLogger {
  return new DrizzleAuditLogger(db);
}
