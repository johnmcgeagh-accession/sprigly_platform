import type { IncomingEvent } from '@sprigly/engine';
import type { EmailInputSpec } from '@sprigly/sources';
import { parseEmailInput } from '@sprigly/sources';
import type { SpriglyMeetingPrepInput } from './types.js';

const SPEC: EmailInputSpec = {
  subjectPrefix: 'Meeting Prep:',
  bodyFields: [
    { key: 'notes', aliases: ['Notes'] },
    // TODO: add body fields your workflow needs
  ],
};

export function parseMeetingPrepInput(event: IncomingEvent): SpriglyMeetingPrepInput | null {
  const subject =
    (event.sourceMetadata['subject'] as string | undefined) ??
    (event.content.structured?.['subject'] as string | undefined) ??
    '';

  const rawBody = (event.content.text ?? '').replace(subject, '').trim();

  const parsed = parseEmailInput(subject, rawBody, SPEC);
  if (parsed === null) return null;

  const result: SpriglyMeetingPrepInput = { topic: parsed.primaryValue };

  const notes = parsed.bodyFields['notes'];
  if (notes !== undefined) result.notes = notes;

  return result;
}
