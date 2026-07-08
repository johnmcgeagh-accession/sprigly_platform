-- 0071: generation prompts for hooks + scripts (redesign Stage 6).
--
-- Global (client_id NULL) prompt_templates rows resolved by DbPromptResolver:
--   plan_hooks/generate    — hook generation (reels + carousels)
--   plan_scripts/generate  — reel script generation
-- Idempotent: inserts only when the (client_id, workflow_id, step_name, version) row is
-- absent, so re-running never duplicates and never clobbers a client override.
--
-- APPLY-BEFORE-DEPLOY. Apply manually:  psql "<DATABASE_URL>" -f 0071_generation_prompts.sql
-- Reverse (LOCAL / emergency ONLY):     psql "<DATABASE_URL>" -f 0071_generation_prompts.down.sql

INSERT INTO "prompt_templates" ("client_id", "workflow_id", "step_name", "prompt_text", "version")
SELECT NULL, 'plan_hooks', 'generate', $prompt$You write scroll-stopping social hooks for a founder-led brand.

You are given the client's voice (voice.md), a post's format/pillar/caption, and a set of
HOOK PATTERNS, each expressed as a STRUCTURE with {slot} placeholders plus one illustrative
example from a different brand.

Rules:
- Imitate the STRUCTURE of a pattern. NEVER reuse the example's content — the examples are
  illustrations only; copying their words is a failure.
- Fill the structure with THIS post's specifics (from the caption/pillar), written in the
  client's voice and register from voice.md.
- One line per hook. Plain language. No hashtags. No emoji unless the client's voice uses them.
- Ground every claim in the caption — invent nothing about the product, fabric, or numbers.
- Return EXACTLY this JSON and nothing else: {"hooks": ["…", "…", "…"]}$prompt$, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_hooks' AND "step_name" = 'generate' AND "version" = 1
);

INSERT INTO "prompt_templates" ("client_id", "workflow_id", "step_name", "prompt_text", "version")
SELECT NULL, 'plan_scripts', 'generate', $prompt$You write short-form video scripts (reels) for a founder-led brand.

You are given the client's voice (voice.md), a post's pillar/caption, the chosen HOOK, and a
TARGET LENGTH in seconds with a words-per-second budget (speak ~2.2 words/second).

Produce a tight, shootable script for that length:
- Open on the given HOOK verbatim as the first spoken line.
- 2–4 BEATS, each a single spoken sentence plus a brief shot/visual suggestion in parentheses,
  timed to fit the target length.
- End with a clear CTA in the client's voice.
- Ground everything in the caption and voice.md; invent no product facts.
- Return plain text in this shape (no JSON, no preamble):
  HOOK: <the hook>
  BEAT 1 (0–Xs) — <line> (<shot>)
  BEAT 2 … 
  CTA: <line>$prompt$, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_scripts' AND "step_name" = 'generate' AND "version" = 1
);
