-- Reverse of 0076_intake_capture_send_log.sql (LOCAL / emergency ONLY).
-- Drops the three send-log columns. Only safe once nothing reads/writes them — i.e. after
-- the intake-capture code change is reverted. Apply manually:
--   psql "<DATABASE_URL>" -f 0076_intake_capture_send_log.down.sql

ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "ask_sent_at";
ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "nudge_sent_at";
ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "last_call_sent_at";
