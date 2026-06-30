--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "client_id", "workflow_id", "step_name", "prompt_text", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  NULL,
  'sprigly-blog-post',
  'research',
  $PROMPT$CRITICAL RULES — FOLLOW EXACTLY:
- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.
  BAD: "Your work isn't good—it is." GOOD: "Your work is good. That is not the problem."
  Use commas, full stops, or parentheses instead.

You are researching a blog post topic for a professional services audience.

Topic: {{topic}}

Return a JSON object with:
- targetKeyword: the primary SEO keyword (2-4 words)
- angles: array of 3-5 key angles or pain points to address
- faq: array of 5 frequently asked questions with answers (objects with "question" and "answer" keys)
- researchNotes: a paragraph summarising the key points to cover

Respond only with valid JSON, no markdown fences.

Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.$PROMPT$,
  1,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = 'sprigly-blog-post'
    AND "step_name" = 'research'
    AND "version" = 1
);

--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "client_id", "workflow_id", "step_name", "prompt_text", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  NULL,
  'sprigly-blog-post',
  'structure',
  $PROMPT$CRITICAL RULES — FOLLOW EXACTLY:
- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.
  BAD: "Your work isn't good—it is." GOOD: "Your work is good. That is not the problem."
  Use commas, full stops, or parentheses instead.

You are structuring a blog post for a professional audience.

Topic: {{topic}}
Research: {{research}}

Return a JSON object with:
- title: an engaging, SEO-optimised title (under 65 characters, no em dashes)
- excerpt: a compelling summary (under 155 characters)
- metaDescription: SEO meta description (under 160 characters)
- category: a single category label (e.g. "Technology", "Strategy", "Operations")
- cta: a short call-to-action sentence for the end of the post

Respond only with valid JSON, no markdown fences.

Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.$PROMPT$,
  1,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = 'sprigly-blog-post'
    AND "step_name" = 'structure'
    AND "version" = 1
);

--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "client_id", "workflow_id", "step_name", "prompt_text", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  NULL,
  'sprigly-blog-post',
  'write',
  $PROMPT$CRITICAL RULES — FOLLOW EXACTLY:
- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.
  BAD: "Your work isn't good—it is." GOOD: "Your work is good. That is not the problem."
  Use commas, full stops, or parentheses instead.
- Do not use: "seamlessly", "unlock", "empower", "leverage", "game-changer", "delve", "in today's", "it's worth noting".

You are writing a professional blog post.

Topic: {{topic}}
Title: {{title}}
Target keyword: {{keyword}}
Research: {{research}}

Write a complete blog post in markdown format, 900-1200 words. Use the title as a H1 heading. Include 3-4 H2 sections. Write in a direct, structured, practical style. Professional without being corporate.

Respond only with valid JSON (no markdown fences, no preamble) containing:
- body: the full markdown blog post content as a string (required)
- slug: a URL-friendly slug for the post, lowercase with hyphens (required)

Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.$PROMPT$,
  1,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = 'sprigly-blog-post'
    AND "step_name" = 'write'
    AND "version" = 1
);

--> statement-breakpoint

-- Fix the Sprigly-specific write prompt if it was seeded with the broken "markdown only" instruction.
UPDATE "prompt_templates"
SET
  "prompt_text" = $PROMPT$CRITICAL RULES — FOLLOW EXACTLY:
- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.
  BAD: "Your work isn't good—it is." GOOD: "Your work is good. That is not the problem."
  Use commas, full stops, or parentheses instead.
- Do not use: "seamlessly", "unlock", "empower", "leverage", "game-changer", "delve", "in today's", "it's worth noting".

You are writing a professional blog post.

Topic: {{topic}}
Title: {{title}}
Target keyword: {{keyword}}
Research: {{research}}

Write a complete blog post in markdown format, 900-1200 words. Use the title as a H1 heading. Include 3-4 H2 sections. Write in a direct, structured, practical style. Professional without being corporate.

Respond only with valid JSON (no markdown fences, no preamble) containing:
- body: the full markdown blog post content as a string (required)
- slug: a URL-friendly slug for the post, lowercase with hyphens (required)

Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.$PROMPT$,
  "updated_at" = now()
WHERE "client_id" = '199678dd-d7d3-4e3b-91b8-8dd8150742d9'
  AND "workflow_id" = 'sprigly-blog-post'
  AND "step_name" = 'write'
  AND "version" = 1;
