-- Reverse of 0086_plan_inputs_backlog.sql (LOCAL / emergency ONLY).
--
-- Drops the backlog columns. Only safe once nothing reads or writes them — i.e. after the
-- Build C classifier and evergreen routing are reverted. Any consumption record is LOST,
-- not archived: used_in_cycle_id is the only place that fact is stored.
--
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0086_plan_inputs_backlog.down.sql

DROP INDEX IF EXISTS "plan_inputs_client_lifecycle_idx";
ALTER TABLE "plan_inputs" DROP COLUMN IF EXISTS "used_in_cycle_id";
ALTER TABLE "plan_inputs" DROP COLUMN IF EXISTS "lifecycle";
ALTER TABLE "plan_inputs" DROP COLUMN IF EXISTS "origin";
