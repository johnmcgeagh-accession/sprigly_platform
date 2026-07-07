-- 0067: step_templates — default checklist per content-type (redesign Stage 1).
--
-- content_type uses the post FORMAT enum values ('reel' | 'carousel' | 'single'),
-- NOT the mockup labels ("Reel" / "Carousel" / "Single image") — see
-- design/DECISIONS.md §Content-type mapping. 'email' has no checklist template.
-- steps is an ordered [{ label, leadDays }] instantiated by POST /checklist/generate.
-- Seed is idempotent (ON CONFLICT DO NOTHING) so re-applying is safe.
--
-- APPLY-BEFORE-DEPLOY: mapped in the Drizzle schema. Apply before deploy.
-- Apply manually:  psql "<DATABASE_URL>" -f 0067_step_templates.sql
-- Reverse (LOCAL / emergency ONLY):  psql "<DATABASE_URL>" -f 0067_step_templates.down.sql

CREATE TABLE IF NOT EXISTS "step_templates" (
  "content_type" text PRIMARY KEY,
  "steps"        jsonb NOT NULL
);

INSERT INTO "step_templates" ("content_type", "steps") VALUES
  ('reel',     '[{"label":"Script & hook","leadDays":4},{"label":"Shoot","leadDays":3},{"label":"Edit","leadDays":2},{"label":"Caption","leadDays":1}]'::jsonb),
  ('carousel', '[{"label":"Source shots","leadDays":3},{"label":"Design frames","leadDays":2},{"label":"Caption","leadDays":1}]'::jsonb),
  ('single',   '[{"label":"Source image","leadDays":2},{"label":"Caption","leadDays":1}]'::jsonb)
ON CONFLICT ("content_type") DO NOTHING;
