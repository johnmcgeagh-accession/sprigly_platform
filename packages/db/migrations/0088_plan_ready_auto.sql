-- 0088_plan_ready_auto — the plan-ready email for a month that went ahead on its own.
--
-- D3: when the cutoff arrives with the draft unapproved, we auto-approve and generate.
-- The client should be told that plainly. "Your plan is ready" reads as though they asked
-- for it; they did not, they just did not answer, and pretending otherwise is the kind of
-- small dishonesty that makes a client distrust the rest of the message.
--
-- A SEPARATE key rather than a version of 'plan_ready', for the same reason 'ask_drafted'
-- was: the resolver takes the highest published version per key (email-send.ts:40-43), so
-- two variants under one key could never be chosen between at send time. A client-approved
-- cycle keeps resolving 'plan_ready' and renders byte-identically to today — that template
-- is not touched.
--
-- email_templates.key DOES carry a CHECK constraint — checked before writing this, and the
-- 0085 lesson is why. It is REPLACED rather than dropped: an unconstrained key column would
-- let a typo'd key insert silently and then resolve to no template at send time.
--
-- Idempotent: guarded on (key, version), which carries a unique index.
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0088_plan_ready_auto.sql

ALTER TABLE "email_templates" DROP CONSTRAINT IF EXISTS "email_templates_key_check";
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_key_check"
  CHECK ("key" = ANY (ARRAY['ask'::text, 'ask_drafted'::text, 'nudge'::text, 'last_call'::text,
                            'plan_ready'::text, 'plan_ready_auto'::text]));

INSERT INTO "email_templates" ("key", "version", "is_published", "subject_template", "body_template")
SELECT
  'plan_ready_auto',
  1,
  true,
  '{{clientName}}: {{monthLabel}} is ready',
  E'Hi {{contactName}},\n\n'
  || E'We didn''t hear back before the cutoff, so we went ahead with the draft we sent you for {{monthLabel}}. It''s written and ready.\n\n'
  || E'Nothing is set in stone. Changes go through your plan as usual, same as any other month:\n{{appLink}}\n\n'
  || E'Thanks,\nThe Sprigly Team'
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates" WHERE "key" = 'plan_ready_auto' AND "version" = 1
);
