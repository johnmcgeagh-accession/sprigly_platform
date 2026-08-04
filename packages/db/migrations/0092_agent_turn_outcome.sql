-- 0092_agent_turn_outcome — a failed turn stops looking like a successful one.
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────
--
-- `turn.ts` catches a thrown parse and writes `metadata.tasks = ["clarify"]`. It catches a
-- thrown query answerer and writes `metadata.tasks = ["query"]`. Both are BYTE-IDENTICAL to
-- their success case. So a model failure, a correct refusal ("I don't have that on file") and a
-- good answer all land as the same row shape, and the only thing separating them is exact-string
-- matching on canned copy — copy that is edited for tone and is not a stable key.
--
-- The consequence is not that the data is thin. It is that the data is WRONG in the one
-- direction that matters: every failure is recorded as a success, so any count of how well the
-- agent is doing is an overcount, and no alert can ever fire.
--
-- ── Why COLUMNS and not another metadata key ──────────────────────────────────────────
--
-- The obvious cheap route is `metadata.outcome`. It was rejected on evidence, not taste.
--
--   1. THERE IS NO SINGLE INSERT PATH TO ENFORCE IT ON. `appendMessage` (app) looked like the
--      one door, and a required TypeScript field there would have been enough. It is not the one
--      door: `engine/src/content-cycles/weekly-session.ts:214` inserts into this table DIRECTLY,
--      from the worker, in a different package that does not import `appendMessage` — 2 such
--      rows are live in UAT today. `packages/db/src/seed-e2e.ts:137` is a third. A TypeScript
--      signature cannot reach either. A NOT NULL column with a default reaches all of them,
--      because the DATABASE applies it.
--
--   2. THE DEFAULT IS THE POINT, AND IT IS 'unknown'. A writer that says nothing gets 'unknown'.
--      It never gets 'answered'. That is the exact inversion of the current behaviour, where
--      silence reads as success — and it is why the default is not NOT NULL-with-no-default,
--      which would make a forgotten field 500 a client's turn. Instrumentation must never be
--      able to break the thing it measures.
--
--   3. `metadata` IS ALREADY THE UNDIFFERENTIATED BAG THIS FIXES. It carries 13 distinct keys
--      written by four code paths, and which keys a row has is the only hint of who wrote it.
--      Adding key 14 to that bag does not make outcomes observable; it makes the bag bigger.
--      `\d agent_messages` should be able to tell you that outcomes are recorded.
--
-- Costs accepted: three columns instead of nothing, and a migration. Both small, once.
--
-- ── The columns ───────────────────────────────────────────────────────────────────────
--
--   writer      WHICH code path produced this row. Four write here and none of them said so, so
--               a receipt from the draft surface and an agent turn were indistinguishable rows.
--               'plan-agent' | 'draft-apply' | 'confirm' | 'weekly-session' | 'unknown'
--
--   outcome     WHAT HAPPENED. On an agent turn, in strict precedence so the diagnostically
--               significant value can never be masked by a cheerier one:
--                 'errored'   something threw and was caught       ← always wins
--                 'declined'  the model correctly said it does not have something on file
--                 'answered'  a query answered from the context it was given
--                 'changed'   proposals were created
--                 'noted'     an idea or note was recorded
--                 'clarified' we asked a question / could not place a request
--               Plus the honest non-turn values: 'user' (a client's own message, which has no
--               outcome), 'receipt', 'confirmation', 'proposed', 'quiet', and 'unknown'.
--
--   error_kind  ONLY when outcome = 'errored': '<stage>:<ErrorName>', e.g. 'parse:TypeError' or
--               'answer-query:ThrottlingException'. One key answers both "where did it break?"
--               and "what broke?", which is what a triage query needs and what the current
--               `catch {}` — which discards the error object entirely — cannot answer at all.
--
-- Deliberately NOT a Postgres enum. The vocabulary above will grow as the agent grows, and
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, which would make every future
-- addition a bigger migration than this one. Text plus a documented vocabulary; the check
-- constraint below pins what exists today without pinning the shape of the future.
--
-- ── Adjacent constraints, checked before writing (the 0085 lesson) ────────────────────
--
--   agent_messages has 8 constraints: 6 NOT NULLs on existing columns, the primary key on `id`,
--   and one foreign key (conversation_id → conversations.id). None touches the new columns.
--   There are NO triggers. Two indexes — agent_messages_pkey and
--   agent_messages_conversation_idx (conversation_id, created_at) — neither of which references
--   anything added here, so nothing is rebuilt.
--
--   340 rows at time of writing. ADD COLUMN ... DEFAULT does not rewrite the table on
--   PostgreSQL 11+ (the default is stored in the catalogue), so this is a metadata-only change
--   and takes a brief ACCESS EXCLUSIVE lock rather than a table rewrite.
--
-- ── Direction, and what the existing 340 rows mean afterwards ─────────────────────────
--
-- Additive only. Every existing row becomes writer='unknown', outcome='unknown', which is the
-- truth: those rows were written before anything recorded an outcome, and we cannot recover one
-- for them without the string-matching this migration exists to replace. They are NOT
-- backfilled to 'answered' — inventing history is the same mistake in a different tense.
--
-- Safe to apply ahead of the code that writes the columns: an old deploy inserting without them
-- gets the defaults. Apply this BEFORE deploying the app.
--
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0092_agent_turn_outcome.sql
-- Reverse (LOCAL / emergency ONLY):
--   psql "<DATABASE_URL>" -f 0092_agent_turn_outcome.down.sql

ALTER TABLE "agent_messages"
  ADD COLUMN "writer"     text NOT NULL DEFAULT 'unknown',
  ADD COLUMN "outcome"    text NOT NULL DEFAULT 'unknown',
  ADD COLUMN "error_kind" text;

-- error_kind is meaningful ONLY on an error, and an error must always name itself. Without this
-- a row could claim 'errored' with no kind (unactionable) or carry a kind while claiming success
-- (incoherent) — the two ways this instrumentation could quietly stop being trustworthy.
ALTER TABLE "agent_messages"
  ADD CONSTRAINT "agent_messages_error_kind_matches_outcome"
  CHECK (("outcome" = 'errored') = ("error_kind" IS NOT NULL));

-- The triage query this exists to serve: "show me every failed turn, newest first."
CREATE INDEX "agent_messages_outcome_idx" ON "agent_messages" ("outcome", "created_at");
