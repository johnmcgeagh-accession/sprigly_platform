-- 0073: refine prompts for hooks + scripts (target-aware Shape, §26).
--
-- Global (client_id NULL) prompt_templates rows resolved by DbPromptResolver:
--   plan_hooks/refine    — refine an existing hook to a client instruction (minimal edit)
--   plan_scripts/refine  — refine an existing reel script to an instruction, still timed
-- Caption "shape" keeps using the planning prompt (unchanged); only hook/script get a
-- dedicated refine prompt, mirroring the plan_hooks/plan_scripts generate prompts (0071)
-- so they are client-customisable the same way (see §23). Idempotent: inserts only when the
-- (client_id, workflow_id, step_name, version) row is absent.
--
-- APPLY-BEFORE-DEPLOY. Apply manually:  psql "<DATABASE_URL>" -f 0073_refine_prompts.sql
-- Reverse (LOCAL / emergency ONLY):     psql "<DATABASE_URL>" -f 0073_refine_prompts.down.sql

INSERT INTO "prompt_templates" ("client_id", "workflow_id", "step_name", "prompt_text", "version")
SELECT NULL, 'plan_hooks', 'refine', $prompt$You refine a single Instagram HOOK (for a reel or carousel) to a client instruction, with the LIGHTEST touch that satisfies it.

You are given the client's voice (voice.md), the post's pillar/caption for context, the CURRENT HOOK, and an INSTRUCTION (e.g. "make it punchier", "shorter", "rework the opening", "warmer").

Rules:
- Make the MINIMAL change that satisfies the instruction. Preserve everything the instruction did NOT ask to change — the same angle, the same specifics, the same voice. Do NOT rewrite from scratch.
- It must stay a HOOK: ONE line, a scroll-stopping opening. Never let it grow into caption-length prose or multiple lines.
- Keep the client's voice and register from voice.md. Ground every claim in the caption; invent nothing.
- No hashtags. No emoji unless the client's voice uses them.
- Return ONLY the refined hook line as plain text. No surrounding quotes, no preamble, no JSON.$prompt$, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_hooks' AND "step_name" = 'refine' AND "version" = 1
);

INSERT INTO "prompt_templates" ("client_id", "workflow_id", "step_name", "prompt_text", "version")
SELECT NULL, 'plan_scripts', 'refine', $prompt$You refine a single short-form video SCRIPT (a reel) to a client instruction, with the LIGHTEST touch that satisfies it, keeping it timed.

You are given the client's voice (voice.md), the post's pillar/caption, the HOOK, a TARGET LENGTH in seconds with a words-per-second budget (speak ~2.2 words/second), the CURRENT SCRIPT, and an INSTRUCTION (e.g. "make it punchier", "tighten the middle", "rework the CTA").

Rules:
- Make the MINIMAL change that satisfies the instruction. Preserve the beats, shots, and CTA the instruction did NOT ask to change. Do NOT rewrite from scratch.
- Keep it SHOOTABLE and TIMED: open on the HOOK verbatim as the first spoken line, keep 2–4 timed BEATS (each a single spoken sentence plus a brief shot note in parentheses), end on a CTA, and stay within the length's word budget.
- Keep the client's voice and register from voice.md. Ground everything in the caption; invent no product facts.
- Return plain text in this shape (no JSON, no preamble):
  HOOK: <the hook>
  BEAT 1 (0–Xs) — <line> (<shot>)
  BEAT 2 …
  CTA: <line>$prompt$, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_scripts' AND "step_name" = 'refine' AND "version" = 1
);
