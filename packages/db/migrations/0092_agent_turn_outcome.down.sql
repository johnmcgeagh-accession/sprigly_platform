-- 0092 DOWN — LOCAL / emergency only.
--
-- Drops the outcome instrumentation. This is LOSSY and unrecoverable: every recorded outcome and
-- every error_kind is destroyed, and the rows revert to the state this migration exists to fix —
-- a failed turn indistinguishable from a successful one. Nothing else in the schema carries the
-- information, so there is no re-derivation afterwards.
--
-- Reversing does NOT break the writing code: the app sets these columns through Drizzle's
-- generated insert, so a deploy that still writes them against a reversed schema will error on
-- insert. Roll the app back FIRST, then run this.
--
-- The index and check constraint go with the columns automatically (DROP COLUMN cascades to
-- both), but they are dropped explicitly here so the reversal reads as the exact inverse of the
-- up migration rather than relying on that.

DROP INDEX IF EXISTS "agent_messages_outcome_idx";

ALTER TABLE "agent_messages"
  DROP CONSTRAINT IF EXISTS "agent_messages_error_kind_matches_outcome";

ALTER TABLE "agent_messages"
  DROP COLUMN IF EXISTS "writer",
  DROP COLUMN IF EXISTS "outcome",
  DROP COLUMN IF EXISTS "error_kind";
