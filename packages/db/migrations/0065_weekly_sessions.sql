-- 0065: weekly_sessions — one row per weekly planning session run.
--
-- Records the audit findings, actioned vs skipped counts, and the change_set_id
-- that groups the proposals the session created. Written by the engine job
-- runWeeklySession.
--
-- APPLY-BEFORE-DEPLOY: mapped in the Drizzle schema. Apply before deploy.
-- Apply manually: psql "<DATABASE_URL>" -f 0065_weekly_sessions.sql

CREATE TABLE IF NOT EXISTS "weekly_sessions" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"      uuid NOT NULL REFERENCES "clients"("id"),
  "cycle_id"       uuid NOT NULL REFERENCES "content_cycles"("id"),
  "week_start"     date NOT NULL,                     -- Monday
  "change_set_id"  uuid,
  "findings"       jsonb,
  "actioned_count" integer NOT NULL DEFAULT 0,
  "skipped_count"  integer NOT NULL DEFAULT 0,
  "status"         text NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'quiet' | 'failed'
  "created_at"     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "weekly_sessions_client_week_idx"
  ON "weekly_sessions" ("client_id", "week_start");
