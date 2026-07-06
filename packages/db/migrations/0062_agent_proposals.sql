-- 0062: proposal-based plan agent — conversations, agent_messages,
-- agent_proposals, plan_inputs.
--
-- The plan agent now persists a conversation of the client's messages (typed or
-- dictated) and the agent's replies, and captures non-structural intents
-- (note_for_month / idea_backlog / next_cycle_input) as agent_proposals the
-- client approves before anything lands. Approval INSERTs a plan_inputs row
-- deterministically. Structural / add / rewrite intents still flow through the
-- existing content_cycle_posts mutations + shape-job pipeline (untouched here).
--
-- APPLY-BEFORE-DEPLOY: these are new tables, so the /api/plan/agent rewrite and
-- the /api/plan/proposals endpoints error until this is live. Existing
-- content-cycle reads are unaffected (no changes to existing tables).
-- Apply manually: psql "<DATABASE_URL>" -f 0062_agent_proposals.sql

CREATE TABLE IF NOT EXISTS "conversations" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"       uuid NOT NULL REFERENCES "clients"("id"),
  "cycle_id"        uuid REFERENCES "content_cycles"("id"),
  "created_at"      timestamp NOT NULL DEFAULT now(),
  "last_message_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "conversations_client_idx"
  ON "conversations" ("client_id", "last_message_at");

CREATE TABLE IF NOT EXISTS "agent_messages" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id"),
  "role"            text NOT NULL,                        -- 'user' | 'assistant'
  "content"         text NOT NULL,
  "source"          text NOT NULL DEFAULT 'web',          -- 'web' | 'voice'
  "created_at"      timestamp NOT NULL DEFAULT now(),
  "metadata"        jsonb                                 -- voice sessionId, classification, proposal ids
);
CREATE INDEX IF NOT EXISTS "agent_messages_conversation_idx"
  ON "agent_messages" ("conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "agent_proposals" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"       uuid NOT NULL REFERENCES "clients"("id"),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id"),
  "message_id"      uuid NOT NULL REFERENCES "agent_messages"("id"),
  "intent"          text NOT NULL,                        -- note_for_month | idea_backlog | next_cycle_input
  "payload"         jsonb NOT NULL,
  "summary"         text NOT NULL,
  "status"          text NOT NULL DEFAULT 'pending',      -- pending|approved|rejected|applied|failed
  "created_at"      timestamp NOT NULL DEFAULT now(),
  "resolved_at"     timestamp,
  "resolved_by"     text,
  "applied_at"      timestamp,
  "error"           text
);
CREATE INDEX IF NOT EXISTS "agent_proposals_client_status_idx"
  ON "agent_proposals" ("client_id", "status");

CREATE TABLE IF NOT EXISTS "plan_inputs" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"          uuid NOT NULL REFERENCES "clients"("id"),
  "cycle_id"           uuid REFERENCES "content_cycles"("id"),
  "type"               text NOT NULL,                     -- 'note' | 'idea' | 'next_cycle'
  "content"            text NOT NULL,
  "source_proposal_id" uuid REFERENCES "agent_proposals"("id"),
  "created_at"         timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "plan_inputs_client_type_idx"
  ON "plan_inputs" ("client_id", "type");
-- Idempotency backstop: one plan_inputs row per source proposal (NULLs distinct,
-- so proposal-less seed rows remain allowed).
CREATE UNIQUE INDEX IF NOT EXISTS "plan_inputs_source_proposal_uniq"
  ON "plan_inputs" ("source_proposal_id");
