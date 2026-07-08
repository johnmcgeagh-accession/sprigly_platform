-- Down for 0070_hooks_scripts. LOCAL verification / emergency rollback ONLY.
DROP INDEX IF EXISTS "hook_patterns_active_idx";
DROP TABLE IF EXISTS "hook_patterns";
ALTER TABLE "content_cycle_posts" DROP COLUMN IF EXISTS "script_length_seconds";
ALTER TABLE "content_cycle_posts" DROP COLUMN IF EXISTS "script";
ALTER TABLE "content_cycle_posts" DROP COLUMN IF EXISTS "hook";
