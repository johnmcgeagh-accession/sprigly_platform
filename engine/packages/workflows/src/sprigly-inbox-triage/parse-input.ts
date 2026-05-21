import type { IncomingEvent } from '@sprigly/engine';
import type { TriageInput } from './types.js';

export function parseTriageInput(event: IncomingEvent): TriageInput | null {
  const meta = event.sourceMetadata;
  const messageId = meta['messageId'] as string | undefined;
  const threadId = meta['threadId'] as string | undefined;

  // The triage workflow is a catch-all — it should always receive a valid
  // Gmail event. Returning null only if the Gmail message ID is absent (which
  // would indicate a mis-routed non-Gmail event).
  if (messageId === undefined || messageId === '') return null;

  return {
    messageId,
    threadId: (threadId as string | undefined) ?? '',
    from: (meta['from'] as string | undefined) ?? '',
    subject: (meta['subject'] as string | undefined) ?? '',
    body: event.content.text,
  };
}
