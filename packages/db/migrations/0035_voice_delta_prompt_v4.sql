-- Voice ingest merge prompt v4: capped evidence + consolidation guidance.
-- Changes from v3: evidence capped at ~15 words / 100 chars with omission example;
-- explicit no-text-before-[ / no-text-after-] guard; consolidation block with
-- expected delta count (5-12) and RULES vs transcript distinction.
-- DbPromptResolver ORDER BY version DESC picks v4 automatically.
-- Apply manually: psql "<DATABASE_URL>" -f 0035_voice_delta_prompt_v4.sql

--> statement-breakpoint
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
Do not include any text before the opening [ or after the closing ].

Each element:
{ "rule": "<imperative rule>",
  "evidence": { "before": "<≤15 words from draft>", "after": "<≤15 words from client version>" },
  "type": "voice" | "factual",
  "action": "add" | "update" | "remove" }

- "voice": stylistic, structural, or vocabulary signal — how to write
- "factual": specific fact, number, product name, or claim that was corrected
- "add": new signal not yet in the profile; "update": refines an existing guideline;
  "remove": contradicts an existing guideline — it should be dropped

Evidence rules:
- "before" and "after" must each be AT MOST ~15 words / 100 characters
- Quote only the key phrase that shows the difference; use "..." to mark omitted context
  e.g. before: "Unlock your wardrobe...potential", after: "Unlock your wardrobe's full potential"
- Never include a full caption — just enough to identify what changed

Consolidation (critical):
- This output is a list of RULES, not a per-edit transcript
- Multiple edits showing the same pattern MUST collapse into ONE delta — pick the
  clearest example for the evidence fields
- Expected output for a month's edits: roughly 5–12 deltas total, regardless of edit count
- Only include clear signals. 3+ edits showing the same pattern = strong signal.
  A single ambiguous edit = noise — omit it.
- If no clear signals found, return: []

Output only the JSON array starting with [ and ending with ].$PROMPT$,
  4,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE client_id IS NULL
    AND workflow_id = 'voice-ingest'
    AND step_name  = 'merge'
    AND version    = 4
);
