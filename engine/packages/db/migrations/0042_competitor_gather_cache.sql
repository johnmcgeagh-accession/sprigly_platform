-- competitor_gather_cache: per-(client, channel) competitor scrape + scoring cache.
-- Stores the structured output of the deterministic gather phase.
-- Consumed by the LLM analysis worker to produce strategic findings.
--
-- Design notes:
--   - gathered_at is a proper column (not only inside raw_data) to support
--     SQL-level staleness queries and UI display without parsing the JSONB blob.
--   - raw_data shape: CompetitorGatherData (engine/packages/engine/src/types.ts)
--     { accounts: CompetitorAccountCache[], benchmark: CompetitorBenchmarkRow[], gatheredAt: string }
--   - Latest-wins upsert (ON CONFLICT DO UPDATE) — no versioning needed at this stage.
--   - One row per (client_id, channel). Re-gather merges stale handles in-place.
--
-- Apply manually: psql "<DATABASE_URL>" -f 0042_competitor_gather_cache.sql

CREATE TABLE IF NOT EXISTS "competitor_gather_cache" (
  "id"          uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "updated_at"  timestamp NOT NULL DEFAULT now(),
  "client_id"   uuid      NOT NULL REFERENCES "clients"("id"),
  "channel"     text      NOT NULL,
  "gathered_at" timestamp NOT NULL,
  "raw_data"    jsonb     NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "competitor_gather_cache_unique" UNIQUE ("client_id", "channel")
);

CREATE INDEX IF NOT EXISTS "competitor_gather_cache_client_idx"
  ON "competitor_gather_cache" ("client_id");
