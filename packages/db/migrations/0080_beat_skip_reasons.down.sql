-- Reverse of 0080_beat_skip_reasons.sql (LOCAL / emergency ONLY).
-- Drops the three per-beat skip-reason columns. Only safe once nothing reads/writes them —
-- i.e. after the skip-reason code change is reverted. Apply manually:
--   psql "<DATABASE_URL>" -f 0080_beat_skip_reasons.down.sql

ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "ask_skip_reason";
ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "nudge_skip_reason";
ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "last_call_skip_reason";
