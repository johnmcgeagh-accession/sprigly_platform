import { db as _db, workflowOutputs } from '@sprigly/db';
import type { Destination, DestinationConfig, DeliveryResult, IncomingEvent } from '@sprigly/engine';

type Db = typeof _db;

/**
 * Generic destination: saves workflow output to workflow_outputs as a draft.
 * Use for new workflows that don't need a specialised table.
 * blog_posts and prospect_sheets are exempt — they have dedicated destinations.
 */
export class DbSaveOutput implements Destination<unknown> {
  id = 'db-save-output';

  constructor(private db: Db) {}

  requiresApproval(_config: DestinationConfig): boolean {
    return false;
  }

  async deliver(output: unknown, event: IncomingEvent, _config: DestinationConfig, runId: string): Promise<DeliveryResult> {
    try {
      const [row] = await this.db.insert(workflowOutputs).values({
        clientId: event.clientId,
        workflowRunId: runId,
        workflowId: '',
        output: output as Record<string, unknown>,
        status: 'draft',
      }).returning({ id: workflowOutputs.id });

      if (!row) return { success: false, error: 'Insert returned no row' };

      return { success: true, metadata: { workflowOutputId: row.id } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
