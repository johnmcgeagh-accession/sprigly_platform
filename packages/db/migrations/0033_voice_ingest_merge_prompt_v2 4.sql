-- Upgrade merge prompt to v2: Sonnet-tuned preserve-baseline version.
-- The v1 Haiku prompt (0031) is superseded; DbPromptResolver ORDER BY version DESC
-- picks v2 automatically. History is retained (v1 row is unchanged).
--
-- Model: intentionally Sonnet. The voice profile is a compounding asset built
-- month-over-month. Under-investing here causes irreversible drift. Sonnet runs
-- once per day at most — not a Haiku cost candidate.

--> statement-breakpoint
INSERT INTO "prompt_templates" (
  "id", "client_id", "workflow_id", "step_name", "prompt_text", "version",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  NULL,
  'voice-ingest',
  'merge',
  $PROMPT$You are updating a brand voice profile for a social media content agency.

Channel: {{channelTitle}}

EXISTING VOICE PROFILE (AUTHORITATIVE BASELINE):
{{currentVoiceProfile}}

CLIENT EDITS THIS MONTH:
{{editSummary}}

INSTRUCTIONS:
The existing voice profile is the authoritative baseline, built from comprehensive corpus analysis. Treat every section — sign-off conventions, vocabulary lists, structural notes, specific examples — as established fact unless the edits provide clear, REPEATED evidence to the contrary.

Rules:
1. PRESERVE: Do not delete, shorten, or weaken any established detail. Sign-off tables, vocabulary lists, and structural notes must survive unless multiple edits in this batch directly contradict them.
2. EVIDENCE THRESHOLD: A guideline changes only when multiple edits in this batch show the same pattern. A single edit that differs from the profile is noise, not signal. One-off exceptions do not revise established rules.
3. EXTEND: If the edits reveal a new, repeated pattern not yet captured in the profile — a consistent phrase, emoji habit, or structural choice — add it to the appropriate section.
4. WEIGHT BY FREQUENCY: Many edits showing the same pattern = signal. One edit = noise. Do not let a single outlier override a well-established guideline.
5. STRUCTURE: Output the full updated channel block using the EXACT same markdown structure as the input. Start with "## {{channelTitle}} — Voice Profile". Preserve all sub-section headings and their content unless directly contradicted.
6. NO INVENTION: Do not add traits, preferences, or style notes that are not evidenced by the edits.

Output ONLY the updated channel block in markdown, starting with "## {{channelTitle}} — Voice Profile". No preamble, no explanation, no code fences.$PROMPT$,
  2,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = 'voice-ingest'
    AND "step_name" = 'merge'
    AND "version" = 2
);
