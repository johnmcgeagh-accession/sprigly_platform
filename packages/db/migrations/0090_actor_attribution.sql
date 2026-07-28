-- 0090_actor_attribution — who actually touched this post.
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────
--
-- The measurement substrate for the untouched-post rate. September's experiment asks "what
-- share of a generated month does a client never touch?", and today that question cannot be
-- answered from the data at all:
--
--   plan_activity.origin is 'user' | 'agent'. 'user' conflates the CLIENT editing their own
--   month through a magic-link session with an OPERATOR editing it on their behalf, which is
--   precisely the distinction the rate is about. A month an operator fixed by hand is not a
--   month the client left alone.
--
--   post_edits has no attribution column of any kind. Every instructed rewrite — the client's
--   own "make it warmer", the fan-out's caption generation, an approved agent proposal — is
--   one undifferentiated row.
--
-- So both tables gain `actor`, in ONE vocabulary: 'client' | 'operator' | 'agent'.
--
-- ── Why a new column rather than widening origin ──────────────────────────────────────
--
-- plan_activity.origin already carries a CHECK enumerating ('user','agent') and is read by
-- shipped code. Adding 'operator' to that enum would silently redefine what an existing
-- 'user' row means: every historical row would become "client or operator, unknown which"
-- while looking like a definite answer. A second, nullable column is honest about exactly
-- that — old rows carry NULL, which reads as "not attributed", not as "the client did it".
--
-- ── Nullable, deliberately ────────────────────────────────────────────────────────────
--
-- No backfill. There is no evidence in the row that says whether a 2026-06 'user' edit came
-- from a session or from an operator, and inventing one would poison the exact measurement
-- this column exists to serve. NULL means unattributed and the analysis excludes it.
--
-- The CHECK is written `IS NULL OR ...` rather than relying on SQL's three-valued logic
-- admitting NULL through `= ANY`. Both accept NULL; only one says so to the next reader.
--
-- ── Adjacent constraints, checked before writing (the 0085 lesson) ────────────────────
--
--   post_edits    — NO check constraints at all. Nothing to preserve or replace.
--   plan_activity — ONE: plan_activity_origin_check, CHECK (origin = ANY ('user','agent')).
--                   It is NOT touched. The new constraint is separate and independent, so
--                   origin's domain is unchanged and a future change to either is isolated.
--
-- plan_activity also carries a BEFORE UPDATE OR DELETE trigger (0068) that raises on any row
-- mutation. ADD COLUMN is DDL, not a row UPDATE, so the trigger does not fire — and because
-- the column is nullable with no default, Postgres does not rewrite the table either.
--
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0090_actor_attribution.sql
-- Reverse (LOCAL / emergency ONLY):
--   psql "<DATABASE_URL>" -f 0090_actor_attribution.down.sql

ALTER TABLE "post_edits" ADD COLUMN IF NOT EXISTS "actor" text;

ALTER TABLE "post_edits" DROP CONSTRAINT IF EXISTS "post_edits_actor_check";
ALTER TABLE "post_edits" ADD CONSTRAINT "post_edits_actor_check"
  CHECK ("actor" IS NULL OR "actor" = ANY (ARRAY['client'::text, 'operator'::text, 'agent'::text]));

ALTER TABLE "plan_activity" ADD COLUMN IF NOT EXISTS "actor" text;

ALTER TABLE "plan_activity" DROP CONSTRAINT IF EXISTS "plan_activity_actor_check";
ALTER TABLE "plan_activity" ADD CONSTRAINT "plan_activity_actor_check"
  CHECK ("actor" IS NULL OR "actor" = ANY (ARRAY['client'::text, 'operator'::text, 'agent'::text]));

-- The untouched-post rate reads (client_id, actor, created_at): "did a client touch anything
-- on this month, and when". Partial on actor IS NOT NULL so the unattributed history — every
-- row written before today — costs the index nothing.
CREATE INDEX IF NOT EXISTS "plan_activity_actor_idx"
  ON "plan_activity" ("client_id", "actor", "created_at")
  WHERE "actor" IS NOT NULL;
