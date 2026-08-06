-- 0093_plan_ready_waiting — the plan-ready emails stop calling a month ready without saying
-- how much of it is waiting on the client.
--
-- A launch beat whose product is in no catalogue is declined at enqueue rather than written
-- from a guess, and it asks its question on its own card. The email is the message that says
-- the month is done; sending "your content plan for September is ready" over three posts
-- nobody has written would make it the last place the omission could have been noticed, and
-- the place it was papered over.
--
-- A NEW VERSION, NOT A NEW KEY — the opposite call from 0085_ask_drafted_template, for the
-- reason that migration states. 0085 needed both variants alive at once (a cycle with a draft
-- and a cycle without), which one key cannot express. Here the opposite is true: every
-- plan-ready send should use the new body, and the two new fields render BLANK when nothing is
-- waiting, so v2 with a blank merge is byte-identical to v1 for every month this does not
-- apply to. A second key would be a fourth template to keep in step
-- (plan_ready x plan_ready_auto x waiting/not) for a difference of one clause.
--
-- ONE PUBLISHED ROW PER KEY, WHICH IS ENFORCED. `email_templates_published_key` is a UNIQUE
-- index on (key) WHERE is_published, so v2 cannot be published alongside v1 — the swap has to
-- happen together or not at all, and it is wrapped in a transaction for exactly that. (The
-- resolver's ORDER BY version DESC is belt-and-braces on top of the index, not the mechanism.)
--
-- WHY TWO MERGE FIELDS. {{waitingClause}} sits INSIDE the sentence, so the claim is never made
-- unqualified; the full stop stays in the template, because a merge field that has to supply
-- punctuation renders a sentence with no end the first time it blanks. {{waitingNote}} is the
-- paragraph after it, alone on its line, so an empty value collapses to exactly the spacing v1
-- has today. Both are in KNOWN_MERGE_FIELDS (email-render.ts) — an unknown field THROWS at
-- render and the send is skipped, which is the guard that makes publishing this safe.
--
-- Digits, not words ("3 posts"), matching {{daysToCutoff}} in the nudge and last-call bodies.
--
-- v1 IS KEPT, UNPUBLISHED. It is the record of what was sent while it was live, and it makes
-- the rollback a two-line UPDATE rather than a restore — see .down.sql.
--
-- Idempotent: the insert is guarded on (key, version) and the unpublish is a no-op on a second
-- run. Apply manually:
--   psql "<DATABASE_URL>" -f 0093_plan_ready_waiting.sql

BEGIN;

-- Retire v1 FIRST: the partial unique index forbids two published rows for one key, so the
-- insert below would be refused if this ran after it.
UPDATE "email_templates" SET "is_published" = false
 WHERE "key" IN ('plan_ready', 'plan_ready_auto') AND "version" = 1;

INSERT INTO "email_templates" ("key", "subject_template", "body_template", "version", "is_published")
SELECT 'plan_ready',
  '{{clientName}}: your content plan for {{monthLabel}} is ready',
  E'Hi,\n\nYour Sprigly content plan for {{monthLabel}} is ready{{waitingClause}}.\n{{waitingNote}}\nOpen and shape it here:\n{{appLink}}\n\nMove posts, edit captions and add ideas — your changes save as you go.\n\nBest,\nSprigly',
  2, true
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates" WHERE "key" = 'plan_ready' AND "version" = 2
);

INSERT INTO "email_templates" ("key", "subject_template", "body_template", "version", "is_published")
SELECT 'plan_ready_auto',
  '{{clientName}}: {{monthLabel}} is ready',
  E'Hi {{contactName}},\n\nWe didn''t hear back before the cutoff, so we went ahead with the draft we sent you for {{monthLabel}}. It''s written and ready{{waitingClause}}.\n{{waitingNote}}\nNothing is set in stone. Changes go through your plan as usual, same as any other month:\n{{appLink}}\n\nThanks,\nThe Sprigly Team',
  2, true
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates" WHERE "key" = 'plan_ready_auto' AND "version" = 2
);

COMMIT;
