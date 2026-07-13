-- intake-capture send log (Build 1): three nullable per-cycle timestamps recording when
-- each outbound touch of the reminder sequence actually SENT (Ask / Nudge / Last Call).
--
-- Distinct from the existing content_cycles.request_sent_at, which records creation of the
-- legacy request-email DRAFT (Level-2, human-approves-before-send) — NOT a send. The three
-- new columns are the true send log for the auto-sending three-touch sequence; do not alias
-- them onto request_sent_at (different mechanism, different meaning). See build report.
--
-- NOTE: the second per-client date (content_cycle_schedule.cutoffDay) is a JSONB shape change
-- only and needs NO DDL — content_cycle_schedule already exists as jsonb; cutoffDay is added
-- in the TypeScript $type/CycleSchedule in the same change. This migration is Part B alone.
--
-- Additive and non-destructive: adds nullable columns only; no backfill, no default, no data
-- touched. APPLY-BEFORE-DEPLOY. Apply manually:
--   psql "<DATABASE_URL>" -f 0076_intake_capture_send_log.sql

ALTER TABLE "content_cycles" ADD COLUMN IF NOT EXISTS "ask_sent_at"       timestamp;
ALTER TABLE "content_cycles" ADD COLUMN IF NOT EXISTS "nudge_sent_at"     timestamp;
ALTER TABLE "content_cycles" ADD COLUMN IF NOT EXISTS "last_call_sent_at" timestamp;
