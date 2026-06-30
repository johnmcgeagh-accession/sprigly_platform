-- 0053: post_edits — audit trail for natural-language caption regens (Phase 3 shape
-- handler). One row per regen: the instruction, caption before/after, whether it
-- passed validation, and token cost. Best-effort write off the hot path (the shape
-- handler skips silently on failure). Mirrors planning_trace's diagnostic value for
-- "what did the rewrite change / did it earn the Bedrock spend".
-- Apply manually: psql "<DATABASE_URL>" -f 0053_post_edits.sql

CREATE TABLE IF NOT EXISTS "post_edits" (
  "id"             uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "post_id"        uuid      NOT NULL REFERENCES "content_cycle_posts"("id"),
  "cycle_id"       uuid      NOT NULL REFERENCES "content_cycles"("id"),
  "scope"          text      NOT NULL,                      -- 'post' | 'plan'
  "instruction"    text      NOT NULL,
  "caption_before" text,
  "caption_after"  text,
  "passed"         boolean   NOT NULL DEFAULT false,
  "tokens"         integer
);

CREATE INDEX IF NOT EXISTS "post_edits_post_idx" ON "post_edits" ("post_id");
