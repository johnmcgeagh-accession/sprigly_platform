import type { IncomingEvent } from '@sprigly/engine';
import type { QuestionAnswererInput } from './types.js';

export function parseQuestionAnswererInput(event: IncomingEvent): QuestionAnswererInput | null {
  const meta = event.sourceMetadata;
  const messageId = meta['messageId'] as string | undefined;
  if (messageId === undefined || messageId === '') return null;

  return {
    messageId,
    threadId:      (meta['threadId']      as string | undefined) ?? '',
    from:          (meta['from']          as string | undefined) ?? '',
    subject:       (meta['subject']       as string | undefined) ?? '',
    body:          event.content.text,
    // Populated by the consumer when auto-chaining from triage.
    ...((() => {
      const t = event.content.structured?.['triageTopicId'] as string | undefined;
      return t !== undefined ? { triageTopicId: t } : {};
    })()),
  };
}
