-- email_templates (intake-capture Build 2): the platform-level, GLOBAL email copy for the
-- three-touch reminder sequence + the plan-ready notification. Deliberately NO client_id
-- column — templates are global by construction (no per-client forks; per-client settings are
-- only the two schedule dates). Versioned: editing = insert a new version and flip is_published.
--
-- Resolution = the published row per key. Enforced:
--   * email_templates_published_key : partial UNIQUE (key) WHERE is_published — at most ONE
--     published version per key.
--   * email_templates_key_version   : UNIQUE (key, version) — versions are distinct per key.
--   * CHECK on key ∈ ('ask','nudge','last_call','plan_ready').
--
-- Merge fields the renderer knows (blank if unset; unknown {{field}} = fail-loud):
--   {{contactName}} {{clientName}} {{monthLabel}} {{cutoffDate}} {{daysToCutoff}}
--   {{intakeLink}} {{appLink}} {{questionsBlock}} {{leanLine}} {{beatsSummary}}
-- ({{leanLine}} and {{beatsSummary}} may render empty until later builds wire their sources.)
--
-- ALL sends are pinned to the test inbox (Stage 1) — no client-facing email. Additive: new
-- table + seed rows only. APPLY-BEFORE-DEPLOY. Apply manually:
--   psql "<DATABASE_URL>" -f 0077_email_templates.sql

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id"               uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "key"              text      NOT NULL,
  "subject_template" text      NOT NULL,
  "body_template"    text      NOT NULL,
  "version"          integer   NOT NULL DEFAULT 1,
  "is_published"     boolean   NOT NULL DEFAULT false,
  "created_at"       timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "email_templates_key_check" CHECK ("key" IN ('ask','nudge','last_call','plan_ready'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_key_version"    ON "email_templates" ("key", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_published_key"  ON "email_templates" ("key") WHERE "is_published";

-- ── Seeds: version 1, published, one per key ─────────────────────────────────

-- ask: the legacy request-email copy in template form (greeting, lean-line + questions
-- placeholders, an intake link, sign-off). Copy kept close to the current builder text.
INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('ask', 1, true,
  '{{clientName}}: content plan for {{monthLabel}}',
  $body$Hi {{contactName}},

we've taken a look at last month's numbers. Here's where the data's pointing.

{{leanLine}}

To shape next month's content, it'd help to hear your thinking on a few things:

{{questionsBlock}}

You can add your thoughts anytime here:
{{intakeLink}}

Thanks,
The Sprigly Team$body$);

-- nudge: short, friendly, mid-window.
INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('nudge', 1, true,
  '{{monthLabel}}: a quick nudge',
  $body$Hi {{contactName}},

{{monthLabel}} generates in {{daysToCutoff}} days — anything happening we should know about? A launch, a date, a story worth telling?

Add anything here:
{{intakeLink}}

Thanks,
The Sprigly Team$body$);

-- last_call: shorter, generates-tomorrow framing + the explicit absolution line.
INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('last_call', 1, true,
  '{{monthLabel}}: last call',
  $body$Hi {{contactName}},

Quick one — {{monthLabel}} generates tomorrow. If there's anything you'd like in it, now's the moment:
{{intakeLink}}

And if nothing's planned, no problem — we'll build the month and you can adjust anything after.

Thanks,
The Sprigly Team$body$);

-- plan_ready: the current sendAppReadyNotification copy, templated verbatim
-- ({{appUrl}} → {{appLink}}). Rendered output is byte-equivalent to today's hardcoded send.
INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('plan_ready', 1, true,
  '{{clientName}}: your content plan for {{monthLabel}} is ready',
  $body$Hi,

Your Sprigly content plan for {{monthLabel}} is ready.

Open and shape it here:
{{appLink}}

Move posts, edit captions and add ideas — your changes save as you go.

Best,
Sprigly$body$);
