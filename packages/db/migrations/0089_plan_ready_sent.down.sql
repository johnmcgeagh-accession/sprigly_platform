-- Reverse of 0089_plan_ready_sent.sql (LOCAL / emergency ONLY).
--
-- Drops the at-most-once stamp. Afterwards nothing records that a plan-ready email was
-- sent, so the next completed run — baseline or settlement — will send again to every
-- cycle that had already been notified. Only safe once the send path is reverted too.
--
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0089_plan_ready_sent.down.sql

ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "plan_ready_sent_at";
