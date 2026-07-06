-- 0063: task-parser rewrite — group a message's proposals, and give notes an
-- inertness window.
--
-- The plan agent now routes EVERY message through the LLM task parser and turns
-- every mutating action into a proposal. All proposals parsed from one message
-- share a change_set_id so the review UI treats them as one unit. Notes are
-- captured directly (not proposals) and carry an optional relevance window plus a
-- status, since they're inert until integrated.
--
-- APPLY-BEFORE-DEPLOY: the columns are now mapped in the Drizzle schema, so
-- select().from(agent_proposals)/plan_inputs references them. This migration MUST
-- be live before the code that maps them deploys.
-- Apply manually: psql "<DATABASE_URL>" -f 0063_agent_changeset_and_note_relevance.sql

ALTER TABLE "agent_proposals"
  ADD COLUMN IF NOT EXISTS "change_set_id" uuid;
CREATE INDEX IF NOT EXISTS "agent_proposals_change_set_idx"
  ON "agent_proposals" ("change_set_id");

ALTER TABLE "plan_inputs"
  ADD COLUMN IF NOT EXISTS "relevant_from" date,
  ADD COLUMN IF NOT EXISTS "relevant_to"   date,
  ADD COLUMN IF NOT EXISTS "status"        text NOT NULL DEFAULT 'active';
