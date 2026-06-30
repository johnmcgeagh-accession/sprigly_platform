/**
 * seed-knowledge.ts — manually seed the knowledge bank for a client.
 *
 * Usage:
 *   # Paste a curated reply inline (quote the text):
 *   pnpm seed:knowledge manual <clientId> "Your reply text here..."
 *
 *   # Paste from a file (for long texts — write to a .txt file first):
 *   pnpm seed:knowledge manual <clientId> --file /path/to/reply.txt
 *
 *   # Scrape an FAQ page:
 *   pnpm seed:knowledge faq_scrape <clientId> <url>
 *
 * The script is idempotent: re-running with identical content is a no-op
 * (content_hash dedup in knowledge_chunks).
 *
 * Run via:
 *   pnpm --filter @sprigly/worker seed:knowledge <args>
 * or directly:
 *   sh -c 'set -a && . ../../.env.local && set +a && tsx scripts/seed-knowledge.ts <args>'
 */

import { readFileSync } from 'fs';
import { db } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { ingestSource } from '@sprigly/knowledge';
import type { IngestInput } from '@sprigly/knowledge';

const [sourceType, clientId, thirdArg, fourthArg] = process.argv.slice(2);

if (!sourceType || !clientId) {
  console.error('Usage: seed-knowledge.ts <manual|faq_scrape> <clientId> <text|--file <path>|url>');
  process.exit(1);
}

if (sourceType !== 'manual' && sourceType !== 'faq_scrape') {
  console.error(`Unknown source type: ${sourceType}. Use 'manual' or 'faq_scrape'.`);
  process.exit(1);
}

let input: IngestInput;

if (sourceType === 'manual') {
  let text: string;
  if (thirdArg === '--file') {
    if (!fourthArg) { console.error('--file requires a path'); process.exit(1); }
    text = readFileSync(fourthArg, 'utf8');
    console.log(`Reading from file: ${fourthArg} (${text.length} chars)`);
  } else if (thirdArg) {
    text = thirdArg;
  } else {
    console.error('manual requires text or --file <path>');
    process.exit(1);
  }
  input = { sourceType: 'manual', text };

} else {
  // faq_scrape
  if (!thirdArg) { console.error('faq_scrape requires a URL'); process.exit(1); }
  input = { sourceType: 'faq_scrape', url: thirdArg };
  console.log(`Scraping FAQ: ${thirdArg}`);
}

const model = createModelClientFromEnv();
const embeddingClient = createEmbeddingClientFromEnv();

console.log(`Ingesting ${sourceType} for client ${clientId}...`);

const result = await ingestSource(clientId, input, {
  db,
  model,
  embeddingClient,
  labelModel: 'haiku',
});

console.log(`Done. inserted=${result.inserted} skipped=${result.skipped} pendingReview=${result.pendingReview}`);
process.exit(0);
