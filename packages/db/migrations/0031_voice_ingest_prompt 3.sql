-- Seed the global default merge prompt for voice:ingest.
-- client_id = NULL makes this the shared fallback; the resolver throws if no row exists
-- for the requested (workflowId, stepName), so the global default is required.
--
-- Variables used at the call site (must stay in sync with MERGE_PROMPT_VARS_KEYS in
-- apps/worker/src/voice-consumer.ts):
--   {{channelTitle}}         — capitalised channel name, e.g. "Instagram"
--   {{currentVoiceProfile}}  — current snapshot_md, or placeholder for first ingest
--   {{editSummary}}          — formatted list of Sprigly draft vs client amendment pairs
--
-- Idempotent: guarded by WHERE NOT EXISTS.

--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "client_id", "workflow_id", "step_name", "prompt_text", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  NULL,
  'voice-ingest',
  'merge',
  $PROMPT$You are updating a brand voice profile for a social media content agency.

Channel: {{channelTitle}}

CURRENT VOICE PROFILE:
{{currentVoiceProfile}}

CLIENT EDITS THIS MONTH (Sprigly draft vs client's actual version):
{{editSummary}}

TASK:
Analyse each edit to identify what the client changed and why. Look for patterns across edits:
- Word choices they add or remove
- Sentence structure and length preferences
- Tone shifts (formal/casual, warm/direct)
- Emoji and punctuation habits
- CTA patterns (how they close posts)
- Any vocabulary they consistently introduce or avoid

Update the voice profile to capture these signals. Rules:
1. Only record signals EVIDENCED by the edits. Do not invent preferences not shown in the changes.
2. If an existing guideline is contradicted by the edits, update it. If confirmed, leave it.
3. Preserve the exact structure: start with "## {{channelTitle}} — Voice Profile", use sub-sections for Tone, Vocabulary (with Use/Avoid lists), Signature phrases, and any others already present.
4. If there is no existing profile, create an initial one from the edits using this structure.
5. Keep each point specific and actionable — a writer should be able to apply it immediately.

Output ONLY the updated channel block in markdown, starting with "## {{channelTitle}} — Voice Profile". No preamble, no explanation, no code fences.$PROMPT$,
  1,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = 'voice-ingest'
    AND "step_name" = 'merge'
    AND "version" = 1
);
