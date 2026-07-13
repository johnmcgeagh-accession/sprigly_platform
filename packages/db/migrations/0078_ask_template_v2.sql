-- ask template v2 (intake-capture Build 2 amendment). The "we've taken a look at last month's
-- numbers…" intro is removed from the template body and folded into what the leanLine SOURCE
-- will emit: {{leanLine}} now carries the whole data paragraph (intro + lean line) INCLUDING its
-- trailing blank line, and sits immediately before the questions transition. So the intro only
-- appears when there IS lean-line content; with leanLine blank the email reads cleanly (greeting
-- → straight to the questions), with no dangling blank lines.
--
-- Editing model: insert the new version, then re-point publication (one published per key). This
-- is a separate migration because 0077 is already applied — 0077 stays the table + v1 seed.
-- Additive. APPLY-BEFORE-DEPLOY.  psql "<DATABASE_URL>" -f 0078_ask_template_v2.sql

INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('ask', 2, false,
  '{{clientName}}: content plan for {{monthLabel}}',
  $body$Hi {{contactName}},

{{leanLine}}To shape next month's content, it'd help to hear your thinking on a few things:

{{questionsBlock}}

You can add your thoughts anytime here:
{{intakeLink}}

Thanks,
The Sprigly Team$body$);

-- Flip publication: unpublish v1 FIRST (so the partial unique never sees two published 'ask'
-- at once), then publish v2.
UPDATE "email_templates" SET "is_published" = false WHERE "key" = 'ask' AND "version" = 1;
UPDATE "email_templates" SET "is_published" = true  WHERE "key" = 'ask' AND "version" = 2;
