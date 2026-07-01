-- 0056: distinct IG-input outcome on the cycle, so "IG ✗" in the prepare panel
--   disambiguates: never ran (no key / no handle) vs ran-but-0-posts-for-month vs
--   failed (quota 402 / bad key 401 / handle mismatch). Previously only a log line.
--   ig_input_status values: 'ok' | 'no_key' | 'no_handle' | 'empty_month'
--     | 'account_mismatch' | 'quota_exhausted' | 'bad_key' | 'error'.
-- Idempotent (ADD COLUMN IF NOT EXISTS).
-- Apply manually: psql "<DATABASE_URL>" -f 0056_ig_input_status.sql

ALTER TABLE "content_cycles"
  ADD COLUMN IF NOT EXISTS "ig_input_status"     text;

ALTER TABLE "content_cycles"
  ADD COLUMN IF NOT EXISTS "ig_input_detail"     text;

ALTER TABLE "content_cycles"
  ADD COLUMN IF NOT EXISTS "ig_input_checked_at" timestamptz;
