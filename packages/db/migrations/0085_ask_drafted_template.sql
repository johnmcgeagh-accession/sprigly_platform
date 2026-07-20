-- 0085_ask_drafted_template — the Ask email variant that carries a draft plan (Build A).
--
-- The intake arc inverts: instead of asking the client what they want and planning after,
-- we draft the month from their own history first and ask them to react to it. This is the
-- email that does the asking, and its whole job is to make reacting easier than composing.
--
-- A SEPARATE key, not a new version of 'ask'. The resolver picks the highest published
-- version for a key (email-send.ts:40-43), so two variants under one key could never be
-- chosen between at send time. With a distinct key, a cycle WITHOUT a draft keeps
-- resolving 'ask' and renders byte-identically to today — the existing template is not
-- touched by this migration at all.
--
-- {{beatsSummary}} is an EXISTING merge field the scheduler already builds and currently
-- renders blank; here it finally has a source. Every field used below is already populated
-- by evaluateThreeTouchForClient's merge object.
--
-- email_templates.key carries a CHECK constraint enumerating the valid keys, so the new
-- key has to be admitted before a row can use it. (Unlike content_cycle_posts.status,
-- which has no domain constraint at all — the two tables genuinely differ here.) The
-- constraint is REPLACED rather than dropped: an unconstrained key column would let a
-- typo'd key insert silently and then resolve to no template at send time.
--
-- Idempotent: keyed insert guarded on (key, version), which carries a unique index.
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0085_ask_drafted_template.sql

ALTER TABLE "email_templates" DROP CONSTRAINT IF EXISTS "email_templates_key_check";
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_key_check"
  CHECK ("key" = ANY (ARRAY['ask'::text, 'ask_drafted'::text, 'nudge'::text, 'last_call'::text, 'plan_ready'::text]));

INSERT INTO "email_templates" ("key", "version", "is_published", "subject_template", "body_template")
SELECT
  'ask_drafted',
  1,
  true,
  '{{clientName}}: your draft plan for {{monthLabel}}',
  E'Hi {{contactName}},\n\n'
  || E'{{leanLine}}We''ve drafted {{monthLabel}} for you based on what''s been working on your feed: {{beatsSummary}}\n\n'
  || E'It''s a starting point, not a finished plan, so tell us where it''s wrong. A few things we weren''t sure about:\n\n'
  || E'{{questionsBlock}}\n\n'
  || E'Have a look and change anything you like here:\n{{intakeLink}}\n\n'
  || E'Thanks,\nThe Sprigly Team'
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates" WHERE "key" = 'ask_drafted' AND "version" = 1
);
