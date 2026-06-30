import type { IncomingEvent } from '@sprigly/engine';
import type { EmailInputSpec } from '@sprigly/sources';
import { parseEmailInput } from '@sprigly/sources';
import type { ProspectInput } from './types.js';

const PROSPECT_SPEC: EmailInputSpec = {
  subjectPrefix: 'Prospect:',
  bodyFields: [
    { key: 'url',           aliases: ['URL', 'Website'] },
    { key: 'sector',        aliases: ['Sector', 'Industry'] },
    { key: 'meetingDate',   aliases: ['Meeting date', 'Meeting'] },
    { key: 'whyInterested', aliases: ['Why interested', 'Why', 'Interest'] },
    { key: 'notes',         aliases: ['Notes'] },
  ],
};

/**
 * Parses a "Prospect: <brandName>" email into a ProspectInput.
 *
 * Subject line: "Prospect: <brandName>" (case-insensitive prefix)
 * Optional body lines (key: value, one per line):
 *   URL:          https://example.co.uk
 *   Sector:       Accountancy
 *   Meeting date: 22 May 2026
 *   Why:          Strong LinkedIn presence, Cotswolds location
 *   Notes:        Two principals, boutique positioning
 *
 * Multi-line values and full parsing rules are handled by parseEmailInput.
 */
export function parseProspectInput(event: IncomingEvent): ProspectInput | null {
  const subject =
    (event.sourceMetadata['subject'] as string | undefined) ??
    (event.content.structured?.['subject'] as string | undefined) ??
    '';

  const rawBody = (event.content.text ?? '').replace(subject, '').trim();

  const parsed = parseEmailInput(subject, rawBody, PROSPECT_SPEC);
  if (parsed === null) return null;

  const result: ProspectInput = { brandName: parsed.primaryValue };

  const url           = parsed.bodyFields['url'];
  const sector        = parsed.bodyFields['sector'];
  const meetingDate   = parsed.bodyFields['meetingDate'];
  const whyInterested = parsed.bodyFields['whyInterested'];
  const notes         = parsed.bodyFields['notes'];

  if (url           !== undefined) result.url           = url;
  if (sector        !== undefined) result.sector        = sector;
  if (meetingDate   !== undefined) result.meetingDate   = meetingDate;
  if (whyInterested !== undefined) result.whyInterested = whyInterested;
  if (notes         !== undefined) result.notes         = notes;

  return result;
}
