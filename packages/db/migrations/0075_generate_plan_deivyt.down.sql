-- Reverse of 0075 (LOCAL / emergency ONLY). Removes the IVY-t per-client generate-plan
-- override and the neutral global v5, restoring resolution to the prior global v4.
-- Apply: psql "<DATABASE_URL>" -f 0075_generate_plan_deivyt.down.sql

DELETE FROM "prompt_templates"
WHERE client_id = (SELECT id FROM "clients" WHERE slug = 'ivy-t')
  AND workflow_id = 'planning' AND step_name = 'generate-plan';

DELETE FROM "prompt_templates"
WHERE client_id IS NULL AND workflow_id = 'planning' AND step_name = 'generate-plan'
  AND version = 5;
