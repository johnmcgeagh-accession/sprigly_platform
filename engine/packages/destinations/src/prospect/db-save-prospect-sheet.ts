/**
 * @deprecated Use db-save-output instead. Kept for historical reference;
 * the prospect_sheets specialised table is legacy from initial scaffolding.
 * Drop this file and migrate the table away when convenient.
 */
import { db as _db, prospectSheets } from '@sprigly/db';
import type { Destination, DestinationConfig, DeliveryResult, DeliveryContext, IncomingEvent } from '@sprigly/engine';
import type { ProspectBriefData } from '@sprigly/pdf-render';

type Db = typeof _db;

interface ProspectOutput {
  data: ProspectBriefData;
}

export class DbSaveProspectSheet implements Destination<unknown> {
  id = 'db-save-prospect-sheet';

  constructor(private db: Db) {}

  requiresApproval(config: DestinationConfig): boolean {
    return config.requireApproval === true;
  }

  async deliver(output: unknown, event: IncomingEvent, _config: DestinationConfig, _ctx: DeliveryContext): Promise<DeliveryResult> {
    try {
      const o = output as ProspectOutput;
      const data = o.data;
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Output missing data field' };
      }

      const [row] = await this.db.insert(prospectSheets).values({
        clientId: event.clientId,
        brandName: data.brandName,
        url: data.url ?? null,
        research: data as unknown as Record<string, unknown>,
        meetingDate: data.meetingDate ?? null,
      }).returning({ id: prospectSheets.id });

      if (!row) return { success: false, error: 'Insert returned no row' };

      return { success: true, metadata: { prospectSheetId: row.id } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
