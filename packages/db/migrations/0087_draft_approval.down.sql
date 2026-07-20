-- Reverse of 0087_draft_approval.sql (LOCAL / emergency ONLY).
--
-- Drops the approval stamp. The FACT of approval is not recoverable afterwards: any
-- already-generated posts keep their content, but why they were generated — and whether a
-- human asked for it — is lost. Only safe once the approval path is reverted.
--
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0087_draft_approval.down.sql

ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "approved_by";
ALTER TABLE "content_cycles" DROP COLUMN IF EXISTS "approved_at";
