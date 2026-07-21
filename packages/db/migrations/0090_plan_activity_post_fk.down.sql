-- Reverse of 0090_plan_activity_post_fk (LOCAL / emergency ONLY).
--
-- ⚠️ THIS RESTORES A KNOWN BREAKAGE. With this constraint back in place, deleting any
-- content_cycle_posts row referenced by a plan_activity row raises "plan_activity is
-- append-only (UPDATE is blocked)" and the delete fails — because the trigger from 0068
-- blocks the UPDATE that ON DELETE SET NULL performs. Draft beat drops will 500 again.
--
-- Only safe if plan_activity_no_mutate is dropped in the same session.
--
-- Rows whose post_id no longer points at a live post will block this ALTER; they must be
-- nulled first, which the trigger also blocks. Drop the trigger, clean up, re-add both.
--
-- Apply manually:  psql "<DATABASE_URL>" -f 0090_plan_activity_post_fk.down.sql

ALTER TABLE "plan_activity"
  ADD CONSTRAINT "plan_activity_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "content_cycle_posts"("id") ON DELETE SET NULL;
