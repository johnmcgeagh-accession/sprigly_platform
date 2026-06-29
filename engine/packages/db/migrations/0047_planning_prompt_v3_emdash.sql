-- Strengthen the generate-plan prompt's no-em-dash rule (belt-and-braces; the
-- deterministic normaliseDashes() strip in plan-validation.ts is the GUARANTEE).
-- The trace (cycle c702fac2) showed 21/21 code-gate repairs were em-dash-only LLM
-- regenerations — pure marginal churn now killed by the deterministic strip. This
-- bumps a new immutable version (3) = version 2 verbatim with ONLY the em-dash
-- CAPTION RULES bullet replaced, so the model also produces fewer dashes at source.
--
-- Built by regexp_replace from the current max version so v3 == v2 + the one line
-- (no risk of drift from re-pasting 11k chars). Idempotent: no-ops if a strengthened
-- version already exists.
-- Apply manually: psql "<DATABASE_URL>" -f 0047_planning_prompt_v3_emdash.sql
--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "client_id", "workflow_id", "step_name", "prompt_text", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  NULL,
  'planning',
  'generate-plan',
  regexp_replace(
    "prompt_text",
    '- No em dashes anywhere\. Use commas, full stops, or colons\.',
    $NEW$- NO DASHES AS PUNCTUATION (hard rule). Never use an em dash (—) or en dash (–) anywhere in a caption: not to join two clauses, not for an aside, not for emphasis, not in a list. Use a comma or a full stop instead, or a colon where a reveal or list follows. A hyphen (-) is allowed ONLY inside a number range (e.g. sizes 10-12) or a genuinely hyphenated word. Em and en dashes are the single most common voice error in drafts, so check every caption for them before you output it.$NEW$
  ),
  "version" + 1,
  now(),
  now()
FROM "prompt_templates"
WHERE "client_id" IS NULL
  AND "workflow_id" = 'planning'
  AND "step_name" = 'generate-plan'
  AND NOT EXISTS (
    SELECT 1 FROM "prompt_templates"
    WHERE "client_id" IS NULL
      AND "workflow_id" = 'planning'
      AND "step_name" = 'generate-plan'
      AND "prompt_text" LIKE '%NO DASHES AS PUNCTUATION%'
  )
ORDER BY "version" DESC
LIMIT 1;
