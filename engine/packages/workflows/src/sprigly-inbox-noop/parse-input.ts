import type { IncomingEvent } from '@sprigly/engine';
import type { InboxNoopInput } from './types.js';

// Accepts every email unconditionally — this is the full-mode catch-all.
// Never returns null.
export function parseInboxNoopInput(event: IncomingEvent): InboxNoopInput {
  return {
    messageId: (event.sourceMetadata['messageId'] as string | undefined) ?? '',
    subject:   (event.sourceMetadata['subject']   as string | undefined) ?? '(no subject)',
    from:      (event.sourceMetadata['from']       as string | undefined) ?? '',
  };
}
