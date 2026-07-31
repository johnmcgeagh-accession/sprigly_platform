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
      // cost_pence is numeric(12,6) since migration 0091, and Drizzle types a numeric column as
      // string. Fixing to exactly six places here is what makes the stored value the computed
      // one: handing Postgres a JS number would round-trip through float notation on the way in,
      // and `1e-7` is not something a numeric column should have to parse.
      costPence: computeCostPence(params.modelId, params.inputTokens, params.outputTokens).toFixed(6),
      metadata: params.metadata ?? {},
    });
  }
}

export function createAuditLogger(db: Db): AuditLogger {
  return new DrizzleAuditLogger(db);
}
