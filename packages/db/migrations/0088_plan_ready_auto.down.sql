-- Reverse of 0088_plan_ready_auto.sql (LOCAL / emergency ONLY).
-- Delete the rows BEFORE narrowing the constraint, or the constraint would reject them.

DELETE FROM "email_templates" WHERE "key" = 'plan_ready_auto';

ALTER TABLE "email_templates" DROP CONSTRAINT IF EXISTS "email_templates_key_check";
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_key_check"
  CHECK ("key" = ANY (ARRAY['ask'::text, 'ask_drafted'::text, 'nudge'::text, 'last_call'::text, 'plan_ready'::text]));
