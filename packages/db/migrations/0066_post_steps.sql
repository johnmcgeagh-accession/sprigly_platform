-- 0066: post_steps — production checklist for a content_cycle_post (redesign Stage 1).
--
-- One row per step. Derivations (due_date = scheduled_date − lead_days, at-risk, the
-- done/total ring) are computed in app code (app/src/lib/checklist.ts), never stored.
-- created_by records agent vs user. Cascade-deletes with its post. updated_at is kept
-- current by the shared set_updated_at() trigger function created in 0050.
--
-- APPLY-BEFORE-DEPLOY: mapped in the Drizzle schema. Apply before deploy.
-- Apply manually:  psql "<DATABASE_URL>" -f 0066_post_steps.sql
-- Reverse (LOCAL verification / emergency rollback ONLY — never casual on a shared DB):
--                  psql "<DATABASE_URL>" -f 0066_post_steps.down.sql

CREATE TABLE IF NOT EXISTS "post_steps" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "post_id"    uuid NOT NULL REFERENCES "content_cycle_posts"("id") ON DELETE CASCADE,
  "label"      text NOT NULL,
  "lead_days"  integer NOT NULL,
  "done"       boolean NOT NULL DEFAULT false,
  "done_at"    timestamptz,
  "sort"       integer NOT NULL DEFAULT 0,
  "created_by" text NOT NULL DEFAULT 'user',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "post_steps_created_by_check" CHECK ("created_by" IN ('agent', 'user'))
);

CREATE INDEX IF NOT EXISTS "post_steps_post_id_idx" ON "post_steps" ("post_id");

-- Keep updated_at current on UPDATE (INSERT default only covers creation).
-- Reuses set_updated_at() defined in 0050_content_cycle_posts.sql.
DROP TRIGGER IF EXISTS "post_steps_set_updated_at" ON "post_steps";
CREATE TRIGGER "post_steps_set_updated_at"
  BEFORE UPDATE ON "post_steps"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
