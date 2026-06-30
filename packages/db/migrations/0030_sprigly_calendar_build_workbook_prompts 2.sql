-- Seed shared default prompts (client_id = NULL) for sprigly-calendar-build-workbook.
-- Replace the placeholder prompt text with your actual prompt before running.
--
-- Idempotent: guarded by WHERE NOT EXISTS.

--> statement-breakpoint

INSERT INTO "prompt_templates" ("id", "workflow_id", "step_name", "prompt_text", "version")
SELECT
  gen_random_uuid(),
  'sprigly-calendar-build-workbook',
  'generate',
  $SPRIGLY_CALENDAR_BUILD_WORKBOOK_GENERATE_PROMPT$
__PROMPT_NOT_CUSTOMISED__

TODO: Replace with the actual generate prompt for sprigly-calendar-build-workbook.

Input variables available:
  {{topic}}   -- the primary value from the email subject line
  {{notes}}   -- optional notes from the email body

Output: ...
$SPRIGLY_CALENDAR_BUILD_WORKBOOK_GENERATE_PROMPT$,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL
    AND "workflow_id" = 'sprigly-calendar-build-workbook'
    AND "step_name" = 'generate'
    AND "version" = 1
);
