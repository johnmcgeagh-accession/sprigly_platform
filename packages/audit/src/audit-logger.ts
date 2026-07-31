import { db as _db, auditLog } from '@sprigly/db';
import type { AuditLogger, LogModelCallParams } from './types.js';
import { computeCostPence, type CacheTokens } from './price-map.js';

type Db = typeof _db;

/**
 * The cache token counts, read off the row's own metadata.
 *
 * They are already there — the conversational call sites record `cacheReadTokens` and
 * `cacheWriteTokens` whenever the provider reports them — so taking them from metadata rather
 * than adding two more top-level params means every existing call site becomes correctly priced
 * without being touched. A caller that never saw a cache simply has neither key.
 *
 * Non-numbers are ignored rather than coerced. `metadata` is `Record<string, unknown>` and a
 * caller could put anything under those names; a bad value must leave the cost unpriced-for-cache
 * rather than turn it into `NaN`, which would poison a numeric column.
 */
function cacheTokensFrom(metadata: Record<string, unknown> | undefined): CacheTokens {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  return {
    cacheReadTokens:  num(metadata?.['cacheReadTokens']),
    cacheWriteTokens: num(metadata?.['cacheWriteTokens']),
  };
}

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
      //
      // Cache tokens come from metadata and are ADDED to the bill — Bedrock reports them
      // separately from inputTokens, so pricing inputTokens alone posted a cached turn ~88% light.
      costPence: computeCostPence(
        params.modelId, params.inputTokens, params.outputTokens,
        cacheTokensFrom(params.metadata),
      ).toFixed(6),
      metadata: params.metadata ?? {},
    });
  }
}

export function createAuditLogger(db: Db): AuditLogger {
  return new DrizzleAuditLogger(db);
}
