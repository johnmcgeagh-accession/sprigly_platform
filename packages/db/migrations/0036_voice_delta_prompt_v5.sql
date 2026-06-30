-- Voice ingest merge prompt v5: action contract + targetSection/targetQuote fields.
-- Changes from v4: action contract requiring update/remove for any signal that
-- overlaps the existing profile; targetSection (exact heading) and targetQuote
-- (≤10-word verbatim snippet) required on every update/remove delta; targetQuote
-- prose-text guidance to avoid quoting decorative formatting.
-- DbPromptResolver ORDER BY version DESC picks v5 automatically.
-- Apply manually: psql "<DATABASE_URL>" -f 0036_voice_delta_prompt_v5.sql

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
  "action": "add" | "update" | "remove",
  "targetSection": "<exact section heading — required for update/remove, omit for add>",
  "targetQuote": "<≤10 verbatim words from the line it amends — required for update/remove, omit for add>" }

- "voice": stylistic, structural, or vocabulary signal — how to write
- "factual": specific fact, number, product name, or claim that was corrected
- "add": new signal genuinely absent from the entire profile
- "update": refines, contradicts, or overlaps anything already in the EXISTING VOICE PROFILE
- "remove": contradicts an existing guideline so strongly it should be dropped

Action contract (critical):
- If a rule refines, contradicts, or overlaps ANYTHING already in the EXISTING VOICE PROFILE,
  you MUST use "update" or "remove" — NOT "add"
- Use "add" ONLY for genuinely new signal absent from the entire profile
- When unsure between "add" and "update", prefer "update" and cite the section
- For every "update" or "remove" delta you MUST include:
    "targetSection": the exact heading of the section it amends (e.g. "Vocabulary", "CTA style",
                     "Signature phrases", "Sentence & structure")
    "targetQuote":   a verbatim snippet of ≤10 words from the bullet or phrase it touches
                     — use readable prose text, not decorative formatting characters
                       such as spaced letters (S u n d a y) or emoji-only markers

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
  5,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE client_id IS NULL
    AND workflow_id = 'voice-ingest'
    AND step_name  = 'merge'
    AND version    = 5
);
