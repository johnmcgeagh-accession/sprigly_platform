import { createHash } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { knowledgeTopics, knowledgeChunks } from '@sprigly/db';
import { labelChunk } from './label-chunk.js';
import { manualChunks } from './adapters/manual.js';
import { faqScrapeChunks } from './adapters/faq-scrape.js';
import { gmailImportChunks } from './adapters/gmail-import.js';
import { approvedDraftChunks } from './adapters/approved-draft.js';
import type { RawChunk, IngestInput, IngestDeps, IngestResult } from './types.js';

function normaliseContent(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashContent(text: string): string {
  return createHash('sha256').update(normaliseContent(text)).digest('hex');
}

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

async function getRawChunks(input: IngestInput): Promise<RawChunk[]> {
  switch (input.sourceType) {
    case 'manual':
      return manualChunks(input.text);
    case 'faq_scrape':
      return faqScrapeChunks(input.url);
    case 'gmail_import':
      return gmailImportChunks(input.gmailClient, input.since);
    case 'approved_draft':
      return approvedDraftChunks(input.text, input.ref);
  }
}

export async function ingestSource(
  clientId: string,
  input: IngestInput,
  deps: IngestDeps,
): Promise<IngestResult> {
  const { db, model, embeddingClient, labelModel, concurrency = 5 } = deps;

  // 1. Get raw chunks from adapter
  const rawChunks = await getRawChunks(input);
  if (rawChunks.length === 0) {
    return { inserted: 0, skipped: 0, pendingReview: 0 };
  }

  // 2. Normalise + hash
  const chunksWithHash = rawChunks.map((c) => ({
    ...c,
    hash: hashContent(c.content),
  }));

  // 3. Bulk dedup — one query for all hashes
  const hashes = chunksWithHash.map((c) => c.hash);
  const existingRows = await db
    .select({ contentHash: knowledgeChunks.contentHash })
    .from(knowledgeChunks)
    .where(and(
      eq(knowledgeChunks.clientId, clientId),
      inArray(knowledgeChunks.contentHash, hashes),
    ));
  const existingSet = new Set(existingRows.map((r) => r.contentHash));
  const novel = chunksWithHash.filter((c) => !existingSet.has(c.hash));

  const skipped = chunksWithHash.length - novel.length;
  if (novel.length === 0) {
    return { inserted: 0, skipped, pendingReview: 0 };
  }

  // 4. Load client taxonomy
  const topics = await db
    .select()
    .from(knowledgeTopics)
    .where(eq(knowledgeTopics.clientId, clientId));

  // 5. Label chunks with bounded concurrency
  const labelTasks = novel.map((c) => () => labelChunk(c.content, topics, model, labelModel));
  const labels = await withConcurrency(labelTasks, concurrency);

  // 6. Embed all surviving chunks in ONE batch call
  const texts = novel.map((c) => c.content);
  const embeddings = await embeddingClient.embedBatch(texts);

  // 7. Upsert — ON CONFLICT DO NOTHING (idempotent)
  const rows = novel.map((c, i) => {
    const label = labels[i]!;
    const embedding = embeddings[i]!;
    return {
      clientId,
      content: c.content,
      contentHash: c.hash,
      topicId:   label.topicId ?? null,
      summary:   label.summary || null,
      keywords:  label.keywords,
      embedding,
      sourceType: input.sourceType,
      sourceRef:  c.ref ?? null,
      status:    (label.topicId != null ? 'active' : 'pending_review') as 'active' | 'pending_review',
    };
  });

  await db.insert(knowledgeChunks).values(rows).onConflictDoNothing();

  const pendingReview = rows.filter((r) => r.status === 'pending_review').length;
  return { inserted: rows.length, skipped, pendingReview };
}
