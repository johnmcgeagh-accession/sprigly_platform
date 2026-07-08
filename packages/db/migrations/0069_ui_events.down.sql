-- Down for 0069_ui_events. LOCAL verification / emergency rollback ONLY.
DROP INDEX IF EXISTS "ui_events_client_created_idx";
DROP TABLE IF EXISTS "ui_events";
