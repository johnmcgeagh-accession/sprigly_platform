-- Strengthen the generate-plan prompt: the client's BRIEF is AUTHORITATIVE for WHAT
-- to feature and WHEN, framed as the principle OVER the STRUCTURED BRIEF (the parsed
-- products / schedule / content_asks / plan_window fed in the user message). It is a
-- framing rule, NOT a second competing list: the structured brief is the concrete
-- "what's briefed"; this prose governs it, and where the two ever differ the
-- structured data wins. The product catalogue stays name/colourway VOCABULARY for
-- grounding and validation ONLY, never a menu to pick heroes from.
--
-- Why: the trace showed the generator receives the full product catalogue with only
-- advisory brief-binding, so it featured an un-briefed product as a hero/launch
-- ("Emma in dark olive arrives") and invented a launch moment for a product the
-- brief never mentioned. Making the brief authoritative fixes BOTH failures at
-- source: an un-briefed product can no longer become a hero/launch, and no launch/
-- "arrives"/timing is invented for a product the brief did not say is launching
-- (so a live product is never framed as upcoming). Nothing outside the brief/data
-- may be presented as briefed.
--
-- Bumps a new immutable version (4) = the current max version verbatim with ONE
-- anchor line ("Work through these steps:") prefixed by a BRIEF AUTHORITY block.
-- Built by regexp_replace from the current max version so v4 == v3 + the block
-- (no risk of drift from re-pasting 11k chars). The anchor occurs exactly once and
-- is untouched by earlier migrations. Idempotent: no-ops if a version already
-- carries the block. The resolver serves MAX(version), so this becomes live.
-- Apply manually: psql "<DATABASE_URL>" -f 0057_planning_prompt_v4_brief_authority.sql
--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "client_id", "workflow_id", "step_name", "prompt_text", "version", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  NULL,
  'planning',
  'generate-plan',
  regexp_replace(
    "prompt_text",
    'Work through these steps:',
    $NEW$BRIEF AUTHORITY (this decides WHAT to feature and WHEN, and overrides your own product picks). The client's brief is authoritative, not advisory, and its concrete form is the STRUCTURED BRIEF in the user message. Treat the STRUCTURED BRIEF as ground truth: its BRIEFED LAUNCHES / RESTOCKS are the ONLY launches and restocks this month; its FIXED DATED BEATS give the dates you must use (do not infer, shift, or de-collide dates of your own); its UNDATED CONTENT PIECES must each appear once in the month; its PLAN WINDOW bounds every date. Where the STRUCTURED BRIEF and the free-text INTAKE ever disagree, the STRUCTURED BRIEF WINS. Build the month from these briefed items first, and treat everything else as secondary to them. The PRODUCTS (catalogue) list is real name and colourway VOCABULARY for grounding and validation only. It is NOT a menu of things to feature, and a product appearing in it is not a reason to feature it; a colourway marked [BRIEFED LAUNCH] there is a real, briefed colourway you may use for the product it sits under. A product that is NOT in the STRUCTURED BRIEF's launches, restocks or schedule may appear ONLY as clearly secondary support (a supporting piece in an outfit, or a light cross sell) and must NEVER be a hero, a launch, a return, or described as "new". Do not invent a launch, a "coming soon", an "arrives" or "goes live" moment, or any date the STRUCTURED BRIEF did not state; if a product is not in the brief as launching or returning, treat it as an already existing product and never imply otherwise. Feature only what the brief and the data actually contain, and never present anything as briefed that the client did not brief.

Work through these steps:$NEW$
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
      AND "prompt_text" LIKE '%BRIEF AUTHORITY%'
  )
ORDER BY "version" DESC
LIMIT 1;
