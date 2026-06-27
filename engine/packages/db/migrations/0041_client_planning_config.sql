-- client_planning_config: per-(client, channel) content planning configuration.
-- Stores structured planning inputs that drive the content-cycle planning worker:
--   pillars          — content pillars with target share ranges
--   competitors      — Instagram handles to track (no @ prefix)
--   format_targets   — Reel/Carousel/Static percentage allocation targets
--   cadence          — posts-per-month and posts-per-week bounds
--   recurring_series — fixed weekly/monthly series (Sunday Style, WSG, etc.)
--   posting_times    — standard time slots for each post type
--   categories       — AUTHORITATIVE list of valid Category column values;
--                      the planning worker must only use values from this list.
--
-- Typed shapes for all JSONB columns: see packages/engine/src/types.ts
-- (Pillar, FormatTargets, Cadence, RecurringSeries, PostingTimes)
--
-- Apply manually: psql "<DATABASE_URL>" -f 0041_client_planning_config.sql

CREATE TABLE IF NOT EXISTS "client_planning_config" (
  "id"               uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"       timestamp NOT NULL DEFAULT now(),
  "updated_at"       timestamp NOT NULL DEFAULT now(),
  "client_id"        uuid      NOT NULL REFERENCES "clients"("id"),
  "channel"          text      NOT NULL,
  "pillars"          jsonb     NOT NULL DEFAULT '[]'::jsonb,
  "competitors"      jsonb     NOT NULL DEFAULT '[]'::jsonb,
  "format_targets"   jsonb     NOT NULL DEFAULT '{}'::jsonb,
  "cadence"          jsonb     NOT NULL DEFAULT '{}'::jsonb,
  "recurring_series" jsonb     NOT NULL DEFAULT '[]'::jsonb,
  "posting_times"    jsonb     NOT NULL DEFAULT '{}'::jsonb,
  "categories"       jsonb     NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "client_planning_config_unique" UNIQUE ("client_id", "channel")
);

CREATE INDEX IF NOT EXISTS "client_planning_config_client_idx"
  ON "client_planning_config" ("client_id");
