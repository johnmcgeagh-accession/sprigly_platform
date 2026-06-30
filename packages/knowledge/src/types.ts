import type { ModelClient } from '@sprigly/model-client';
import type { EmbeddingClient } from '@sprigly/embedding-client';
import type { GmailApiClient } from '@sprigly/sources';
import type { db as _db } from '@sprigly/db';

export type Db = typeof _db;

export interface RawChunk {
  content: string;
  ref?: string;
}

export interface LabelResult {
  topicId: string | null;
  keywords: string[];
  summary: string;
}

export interface IngestDeps {
  db: Db;
  model: ModelClient;
  embeddingClient: EmbeddingClient;
  labelModel: string;
  concurrency?: number;
}

export type IngestInput =
  | { sourceType: 'manual'; text: string }
  | { sourceType: 'faq_scrape'; url: string }
  | { sourceType: 'gmail_import'; gmailClient: GmailApiClient; since?: Date }
  | { sourceType: 'approved_draft'; text: string; ref: string };

export interface IngestResult {
  inserted: number;
  skipped: number;
  pendingReview: number;
}
