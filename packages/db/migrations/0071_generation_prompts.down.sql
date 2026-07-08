-- Down for 0071_generation_prompts. LOCAL verification / emergency rollback ONLY.
DELETE FROM "prompt_templates"
 WHERE "client_id" IS NULL AND "workflow_id" IN ('plan_hooks', 'plan_scripts') AND "step_name" = 'generate';
