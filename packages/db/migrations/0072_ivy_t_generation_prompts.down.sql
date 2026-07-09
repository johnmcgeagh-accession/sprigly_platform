-- Down for 0072_ivy_t_generation_prompts. LOCAL verification / emergency rollback ONLY.
-- Removes only the ivy-t client-scoped generation prompts; the global defaults (0071) stay.
DELETE FROM "prompt_templates"
 WHERE "client_id" = (SELECT id FROM clients WHERE slug = 'ivy-t')
   AND "workflow_id" IN ('plan_hooks', 'plan_scripts')
   AND "step_name" = 'generate'
   AND "version" = 1;
