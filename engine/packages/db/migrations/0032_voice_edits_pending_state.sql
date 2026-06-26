-- Add pending-state tracking to voice_edits for the batched merge model.
--
-- Previously detect-edits created a voice_ingestion_runs row and set ingestion_run_id
-- on every voice_edits row immediately. Now:
--   - detect-edits writes voice_edits rows with ingestion_run_id = NULL, ingested_at = NULL
--   - ingested_at IS NULL  → PENDING (not yet consumed by the daily batch merge)
--   - ingested_at IS NOT NULL → consumed; ingestion_run_id points to the batch merge run
--
-- ingestion_run_id was NOT NULL; drop that constraint so detect-edits can insert without it.

--> statement-breakpoint
ALTER TABLE "voice_edits"
  ALTER COLUMN "ingestion_run_id" DROP NOT NULL;

--> statement-breakpoint
ALTER TABLE "voice_edits"
  ADD COLUMN "ingested_at" timestamp;

-- Partial index for fast pending-batch lookup.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_edits_pending"
  ON "voice_edits" ("client_id", "channel")
  WHERE "ingested_at" IS NULL;
