-- 0069: ui_events — minimal product telemetry for the plan surface (redesign Stage 5).
--
-- Separate from plan_activity (which is the plan-mutation ledger). ui_events records
-- what the client did in the UI: view switches, approvals, agent asks, step ticks,
-- shape requests. Not a source of truth, so no append-only trigger.
--
-- APPLY-BEFORE-DEPLOY: mapped in the Drizzle schema. Apply before deploy.
-- Apply manually:  psql "<DATABASE_URL>" -f 0069_ui_events.sql
-- Reverse (LOCAL / emergency ONLY):  psql "<DATABASE_URL>" -f 0069_ui_events.down.sql

CREATE TABLE IF NOT EXISTS "ui_events" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"  uuid NOT NULL REFERENCES "clients"("id"),
  "event"      text NOT NULL,
  "payload"    jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ui_events_client_created_idx" ON "ui_events" ("client_id", "created_at");
