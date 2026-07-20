-- Reverse of 0085_ask_drafted_template.sql (LOCAL / emergency ONLY).
--
-- Removes the draft-carrying Ask variant. Safe at any time: with no published
-- 'ask_drafted' row the scheduler's draft branch finds no template, the send fails, and
-- the touch records send_failed — so prefer reverting the scheduler change alongside this,
-- which makes every cycle resolve plain 'ask' again.
--
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0085_ask_drafted_template.down.sql

DELETE FROM "email_templates" WHERE "key" = 'ask_drafted';

-- Restore the original key domain (must run AFTER the delete, or it would reject the rows).
ALTER TABLE "email_templates" DROP CONSTRAINT IF EXISTS "email_templates_key_check";
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_key_check"
  CHECK ("key" = ANY (ARRAY['ask'::text, 'nudge'::text, 'last_call'::text, 'plan_ready'::text]));
