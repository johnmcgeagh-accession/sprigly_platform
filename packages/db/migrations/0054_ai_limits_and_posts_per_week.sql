-- 0054: AI-change limits + posts-per-week (Phase 4).
--   client_channels gains a monthly AI-change allowance (rewrites/regen only —
--   structural edits are never counted), an optional override that lifts the cap
--   until a future timestamp, and an optional posts-per-week cadence override.
--   Also indexes post_edits for the monthly per-client usage count (it is now READ
--   at runtime by /api/usage, not just diagnostic).
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
-- Apply manually: psql "<DATABASE_URL>" -f 0054_ai_limits_and_posts_per_week.sql

ALTER TABLE "client_channels"
  ADD COLUMN IF NOT EXISTS "ai_change_limit"               integer     NOT NULL DEFAULT 30;

ALTER TABLE "client_channels"
  ADD COLUMN IF NOT EXISTS "ai_change_limit_override_until" timestamptz;

ALTER TABLE "client_channels"
  ADD COLUMN IF NOT EXISTS "posts_per_week"                integer;      -- null = derive from history/config (unchanged behaviour)

-- Monthly AI-change count: filter post_edits by created_at, join to content_cycles
-- on cycle_id (which carries client_id + channel). Serves the usage read.
CREATE INDEX IF NOT EXISTS "post_edits_cycle_created_idx" ON "post_edits" ("cycle_id", "created_at");
