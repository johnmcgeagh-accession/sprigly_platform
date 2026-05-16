import type { IncomingEvent } from '@sprigly/engine';
import type { ProspectInput } from './types.js';

const PREFIX = 'prospect:';

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
 */
export function parseProspectInput(event: IncomingEvent): ProspectInput | null {
  const subject =
    (event.sourceMetadata['subject'] as string | undefined) ??
    (event.content.structured?.['subject'] as string | undefined) ??
    '';

  if (!subject.toLowerCase().startsWith(PREFIX)) return null;

  const brandName = subject.slice(PREFIX.length).trim();
  if (brandName === '') return null;

  const result: ProspectInput = { brandName };

  const body =
    (event.content.text ?? '').replace(subject, '').trim();

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;

    const colonAt = line.indexOf(':');
    if (colonAt === -1) continue;

    const key   = line.slice(0, colonAt).trim().toLowerCase();
    const value = line.slice(colonAt + 1).trim();
    if (value === '') continue;

    if (key === 'url')                        result.url          = value;
    else if (key === 'sector')                result.sector       = value;
    else if (key === 'meeting date' || key === 'meeting') result.meetingDate  = value;
    else if (key === 'why' || key === 'why interested')   result.whyInterested = value;
    else if (key === 'notes')                 result.notes        = value;
  }

  return result;
}
