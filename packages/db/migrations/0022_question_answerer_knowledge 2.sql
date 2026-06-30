--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;

--> statement-breakpoint
CREATE TYPE "knowledge_source" AS ENUM ('faq_scrape', 'gmail_import', 'approved_draft', 'manual');

--> statement-breakpoint
CREATE TYPE "knowledge_status" AS ENUM ('active', 'archived', 'pending_review');

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_topics" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"   uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "description" text,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "updated_at"  timestamp NOT NULL DEFAULT now(),
  UNIQUE ("client_id", "name")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"    uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "topic_id"     uuid REFERENCES "knowledge_topics"("id") ON DELETE SET NULL,
  "content"      text NOT NULL,
  "summary"      text,
  "keywords"     text[] NOT NULL DEFAULT '{}',
  "embedding"    vector(1024),
  "source_type"  "knowledge_source" NOT NULL,
  "source_ref"   text,
  "status"       "knowledge_status" NOT NULL DEFAULT 'active',
  "content_hash" text NOT NULL,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now(),
  UNIQUE ("client_id", "content_hash")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_client_topic_status"
  ON "knowledge_chunks" ("client_id", "topic_id", "status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_embedding"
  ON "knowledge_chunks" USING hnsw (embedding vector_cosine_ops);
