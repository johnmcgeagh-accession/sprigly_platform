-- Voice ingest merge prompt v3: delta extraction.
-- Replaces the full-rewrite (v2) prompt with one that returns a bounded JSON
-- array of rule deltas. Same three template vars: channelTitle,
-- currentVoiceProfile, editSummary.
-- Apply manually: psql "$DATABASE_URL" -f 0034_voice_delta_prompt_v3.sql

INSERT INTO "prompt_templates" (
  "id", "client_id", "workflow_id", "step_name", "prompt_text",
  "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  NULL,
  'voice-ingest',
  'merge',
  $PROMPT$You extract voice and factual signals from client edits to a social media content agency's published drafts.

Channel: {{channelTitle}}

EXISTING VOICE PROFILE (context only — do not rewrite):
{{currentVoiceProfile}}

CLIENT EDITS THIS MONTH:
{{editSummary}}

Return ONLY a JSON array. No prose, no markdown fences, no preamble.

Each element:
{ "rule": "<imperative rule>",
  "evidence": { "before": "<agency draft>", "after": "<client version>" },
  "type": "voice" | "factual",
  "action": "add" | "update" | "remove" }

- "voice": stylistic, structural, or vocabulary signal — how to write
- "factual": specific fact, number, product name, or claim that was corrected
- "add": new signal not yet in the profile
- "update": refines or corrects an existing guideline
- "remove": contradicts an existing guideline — it should be dropped
- Only include clear signals. 3+ edits showing the same pattern = strong signal.
  A single ambiguous edit = noise — omit it.
- If no clear signals found, return: []

Output only the JSON array starting with [ and ending with ].$PROMPT$,
  3,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE client_id IS NULL
    AND workflow_id = 'voice-ingest'
    AND step_name  = 'merge'
    AND version    = 3
);
