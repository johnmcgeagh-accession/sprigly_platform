-- 0068: plan_activity — append-only ledger of plan changes (redesign Stage 1, AUDIT §3).
--
-- ONE ordered stream regardless of actor: manual edits insert origin='user'; approved
-- agent proposals insert origin='agent' + ref_proposal_id. Append-only is enforced at
-- the DB layer by a BEFORE UPDATE OR DELETE trigger (not just by convention). post_id
-- is ON DELETE SET NULL so history survives a (hard) post delete.
--
-- APPLY-BEFORE-DEPLOY: mapped in the Drizzle schema. Apply before deploy.
-- Apply manually:  psql "<DATABASE_URL>" -f 0068_plan_activity.sql
-- Reverse (LOCAL / emergency ONLY):  psql "<DATABASE_URL>" -f 0068_plan_activity.down.sql

CREATE TABLE IF NOT EXISTS "plan_activity" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"       uuid NOT NULL REFERENCES "clients"("id"),
  "cycle_id"        uuid REFERENCES "content_cycles"("id"),
  "post_id"         uuid REFERENCES "content_cycle_posts"("id") ON DELETE SET NULL,
  "origin"          text NOT NULL,
  "action"          text NOT NULL,
  "ref_proposal_id" uuid REFERENCES "agent_proposals"("id"),
  "payload"         jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plan_activity_origin_check" CHECK ("origin" IN ('user', 'agent'))
);

CREATE INDEX IF NOT EXISTS "plan_activity_client_created_idx" ON "plan_activity" ("client_id", "created_at");
CREATE INDEX IF NOT EXISTS "plan_activity_post_id_idx" ON "plan_activity" ("post_id");

-- Append-only: block UPDATE and DELETE at the data layer, not just by convention.
CREATE OR REPLACE FUNCTION plan_activity_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'plan_activity is append-only (% is blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "plan_activity_no_mutate" ON "plan_activity";
CREATE TRIGGER "plan_activity_no_mutate"
  BEFORE UPDATE OR DELETE ON "plan_activity"
  FOR EACH ROW EXECUTE FUNCTION plan_activity_append_only();
