-- Reverse of 0077_email_templates.sql (LOCAL / emergency ONLY).
-- Drops the email_templates table (and its indexes/seeds). Only safe once nothing
-- reads it — i.e. after the intake-capture email code change is reverted. Apply manually:
--   psql "<DATABASE_URL>" -f 0077_email_templates.down.sql

DROP TABLE IF EXISTS "email_templates";
