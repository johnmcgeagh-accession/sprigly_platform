-- 0064: client location (for the weekly session's weather audit) + the notes
-- lifecycle.
--
-- Clients gain lat/lon/location_name (all nullable) — the weekly session skips the
-- weather pass when they're unset. plan_inputs gains source (where the note came
-- from) and consumed_by_proposal_id (the proposal that integrated it). Notes now
-- move active → integrated | expired | dismissed (the status column, from 0063).
--
-- APPLY-BEFORE-DEPLOY: the columns are mapped in the Drizzle schema, so
-- select().from(clients)/plan_inputs references them. Apply before deploy.
-- Apply manually: psql "<DATABASE_URL>" -f 0064_client_location_and_note_lifecycle.sql

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "lat"           double precision,
  ADD COLUMN IF NOT EXISTS "lon"           double precision,
  ADD COLUMN IF NOT EXISTS "location_name" text;

ALTER TABLE "plan_inputs"
  ADD COLUMN IF NOT EXISTS "source"                  text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS "consumed_by_proposal_id" uuid REFERENCES "agent_proposals"("id");

-- Set IVY-t's location once her city is known (weather stays skipped until then):
--   UPDATE "clients" SET lat = <lat>, lon = <lon>, location_name = '<City, UK>'
--    WHERE slug = 'ivy-t';
-- e.g. London: lat = 51.5072, lon = -0.1276, location_name = 'London, UK'.
