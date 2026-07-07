-- Down for 0066_post_steps. LOCAL verification / emergency rollback ONLY.
-- Drops the post_steps table (and its trigger + index). set_updated_at() is shared
-- with content_cycle_posts, so it is intentionally NOT dropped here.
DROP TRIGGER IF EXISTS "post_steps_set_updated_at" ON "post_steps";
DROP INDEX IF EXISTS "post_steps_post_id_idx";
DROP TABLE IF EXISTS "post_steps";
