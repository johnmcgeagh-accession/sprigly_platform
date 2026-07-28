-- 0090 DOWN — LOCAL / emergency only.
--
-- Drops the attribution columns and everything hanging off them. This is lossy: the actor of
-- every write made while 0090 was applied is gone and cannot be reconstructed, for the same
-- reason the up migration does not backfill — nothing else in the row records it.
--
-- plan_activity_origin_check is deliberately untouched here as well: 0090 never modified it,
-- so a reversal has no business restoring it.

DROP INDEX IF EXISTS "plan_activity_actor_idx";

ALTER TABLE "plan_activity" DROP CONSTRAINT IF EXISTS "plan_activity_actor_check";
ALTER TABLE "plan_activity" DROP COLUMN IF EXISTS "actor";

ALTER TABLE "post_edits" DROP CONSTRAINT IF EXISTS "post_edits_actor_check";
ALTER TABLE "post_edits" DROP COLUMN IF EXISTS "actor";
