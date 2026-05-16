import { db as _db, workflowOutputs } from '@sprigly/db';
import type { Destination, DestinationConfig, DeliveryResult, DeliveryContext, IncomingEvent } from '@sprigly/engine';
import { stripBuffers } from '@sprigly/engine';

type Db = typeof _db;

/**
 * Generic destination: saves workflow output to workflow_outputs as a draft.
 * Use for new workflows that don't need a specialised table.
 *
 * If the output has a top-level `data` field (e.g. ProspectOutput { data, pdf }),
 * only `data` is stored — Buffers and envelope fields are excluded.
 * Otherwise the full output (Buffers stripped to '[binary]') is stored.
 */
export class DbSaveOutput implements Destination<unknown> {
  id = 'db-save-output';

  constructor(private db: Db) {}

  requiresApproval(_config: DestinationConfig): boolean {
    return false;
  }

  async deliver(output: unknown, event: IncomingEvent, _config: DestinationConfig, ctx: DeliveryContext): Promise<DeliveryResult> {
    try {
      const stripped = stripBuffers(output) as Record<string, unknown>;
      const toSave: Record<string, unknown> =
        stripped !== null &&
        typeof stripped === 'object' &&
        'data' in stripped &&
        stripped['data'] !== null &&
        typeof stripped['data'] === 'object'
          ? (stripped['data'] as Record<string, unknown>)
          : stripped;

      const [row] = await this.db.insert(workflowOutputs).values({
        clientId: event.clientId,
        workflowRunId: ctx.runId,
        workflowId: ctx.workflowId,
        output: toSave,
        status: 'draft',
      }).returning({ id: workflowOutputs.id });

      if (!row) return { success: false, error: 'Insert returned no row' };

      return { success: true, metadata: { workflowOutputId: row.id } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
