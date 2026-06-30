import { extractMessageText } from '@sprigly/sources';
import type { GmailApiClient } from '@sprigly/sources';
import { splitText } from '../chunk-splitter.js';
import type { RawChunk } from '../types.js';

function stripSignatureAndQuotes(text: string): string {
  // Cut at standard signature delimiter
  const sigIdx = text.search(/^--\s*$/m);
  if (sigIdx !== -1) text = text.slice(0, sigIdx);

  // Cut at Gmail/Outlook quoted-thread header
  const quoteIdx = text.search(/^On .+wrote:\s*$/m);
  if (quoteIdx !== -1) text = text.slice(0, quoteIdx);

  // Remove > prefixed lines (quoted reply lines)
  text = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');

  return text.trim();
}

export async function gmailImportChunks(
  gmailClient: GmailApiClient,
  since?: Date,
): Promise<RawChunk[]> {
  const sinceDate = since ?? null;
  const messageIds = await gmailClient.listSentMessageIds(sinceDate);

  const chunks: RawChunk[] = [];
  for (const id of messageIds) {
    try {
      const message = await gmailClient.getMessage(id);
      const raw = extractMessageText(message);
      const cleaned = stripSignatureAndQuotes(raw);
      if (cleaned.length < 30) continue;

      const contents = splitText(cleaned);
      for (const content of contents) {
        chunks.push({ content, ref: id });
      }
    } catch (err) {
      console.warn(`[knowledge] gmail_import: skipping message ${id}`, err);
    }
  }

  return chunks;
}
