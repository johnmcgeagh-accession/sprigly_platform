-- Down for 0068_plan_activity. LOCAL verification / emergency rollback ONLY.
-- The append-only trigger blocks row UPDATE/DELETE, but DDL (DROP) is unaffected.
DROP TRIGGER IF EXISTS "plan_activity_no_mutate" ON "plan_activity";
DROP FUNCTION IF EXISTS plan_activity_append_only();
DROP INDEX IF EXISTS "plan_activity_client_created_idx";
DROP INDEX IF EXISTS "plan_activity_post_id_idx";
DROP TABLE IF EXISTS "plan_activity";
