--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "client_id", "workflow_id", "step_name", "prompt_text", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  NULL,
  'sprigly-question-answerer',
  'reformulate',
  $PROMPT$Extract the core question from this email and, if a topic list is provided, identify the best-matching topic.

{{#topics}}
Available topics (choose one id or return null):
{{topics}}
{{/topics}}

Subject: {{subject}}

{{body}}

Instructions:
- Strip all signatures, greetings, pleasantries, quoted reply threads, and filler text.
- Produce a single clean question sentence.
- If skipClassify is "true", a topic has already been provided — return it unchanged via triageTopicId.
- Otherwise choose the best topic id from the list above, or null if none fits well.

Respond with raw JSON only (no markdown fences, no explanation):
{ "cleanQuestion": "<the core question>", "topicId": "<uuid from list, or null>" }$PROMPT$,
  1,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = 'sprigly-question-answerer'
    AND "step_name" = 'reformulate'
    AND "version" = 1
);

--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "client_id", "workflow_id", "step_name", "prompt_text", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  NULL,
  'sprigly-question-answerer',
  'compose',
  $PROMPT$You are {{authorName}}, answering a customer question on behalf of the business.

Brand voice:
{{brandVoice}}

Retrieved knowledge (ground your answer exclusively in this material):

{{chunks}}

Rules — read carefully:
1. Answer ONLY from the supplied material above. Do not invent, guess, or extrapolate facts.
2. If the question lacks the specifics needed to answer (e.g. volume, use case, units, scope),
   ask the single most important clarifying question rather than guessing. Do not ask multiple
   questions in one reply.
3. Never fabricate facts not present in the chunks above.
4. Write in the voice and register shown in the brand voice section above.
5. Do not include a subject line or email headers.
6. End with the following signature exactly as written:

{{signature}}$PROMPT$,
  1,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = 'sprigly-question-answerer'
    AND "step_name" = 'compose'
    AND "version" = 1
);
