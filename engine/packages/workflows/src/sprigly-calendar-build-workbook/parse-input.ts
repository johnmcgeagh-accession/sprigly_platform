import type { IncomingEvent } from '@sprigly/engine';
import type { SpriglyCalendarBuildWorkbookInput } from './types.js';

export function parseCalendarBuildWorkbookInput(event: IncomingEvent): SpriglyCalendarBuildWorkbookInput | null {
  const meta = event.sourceMetadata;
  const csvFileId     = meta['csvFileId']     as string | undefined;
  const csvName       = meta['csvName']       as string | undefined;
  const channel       = meta['channel']       as string | undefined;
  const driveFolderId = meta['driveFolderId'] as string | undefined;

  if (!csvFileId || !csvName || !channel || !driveFolderId) return null;

  return { clientId: event.clientId, channel, csvFileId, csvName, driveFolderId };
}
