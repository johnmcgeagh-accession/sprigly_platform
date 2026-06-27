-- client_planning_config: per-(client, channel) content planning configuration.
-- Drives the content-cycle planning worker (intake_confirmed → planning).
--
-- Design notes:
--   - format_targets deliberately ABSENT: the planning agent reasons format balance
--     from competitor analysis at plan time, not from fixed config.
--   - Pillar % target shares deliberately ABSENT: same reasoning.
--   - categories is the AUTHORITATIVE vocabulary for the Category column in the
--     plan CSV and Excel workbook. The planning worker must only use values from
--     this list; new categories must be added here before use.
--   - voice rules stay in voice.md / voice pipeline — not here.
--
-- Typed JSONB shapes: packages/engine/src/types.ts
--   (Pillar, Cadence, RecurringSeries, PostingTimes)
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
  "cadence"          jsonb     NOT NULL DEFAULT '{}'::jsonb,
  "recurring_series" jsonb     NOT NULL DEFAULT '[]'::jsonb,
  "posting_times"    jsonb     NOT NULL DEFAULT '{}'::jsonb,
  "categories"       jsonb     NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "client_planning_config_unique" UNIQUE ("client_id", "channel")
);

CREATE INDEX IF NOT EXISTS "client_planning_config_client_idx"
  ON "client_planning_config" ("client_id");
