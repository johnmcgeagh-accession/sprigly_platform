-- 0055: oauth_connections health metadata.
--   The `status` column already exists ('active' | 'revoked' | 'error') but was
--   never set to anything but 'active'. Phase: on invalid_grant a poller flips
--   status='error' (which drops the row from every where(status='active') poll,
--   stopping the retry storm), records the error, and the admin panel surfaces it.
--   last_ok_at is bumped on every successful token use / reconnect.
-- Idempotent (ADD COLUMN IF NOT EXISTS).
-- Apply manually: psql "<DATABASE_URL>" -f 0055_oauth_connection_health.sql

ALTER TABLE "oauth_connections"
  ADD COLUMN IF NOT EXISTS "last_ok_at"     timestamptz;

ALTER TABLE "oauth_connections"
  ADD COLUMN IF NOT EXISTS "last_error"     text;

ALTER TABLE "oauth_connections"
  ADD COLUMN IF NOT EXISTS "last_error_at"  timestamptz;
