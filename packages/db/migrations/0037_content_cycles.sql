-- content_cycles: one row per (client, channel, month) orchestration cycle.
-- Status is text (not a PG enum) to match the convention used throughout this schema.
-- prior_status: set when transitioning → failed so the retry step is recoverable.
-- pending_deltas_json: stores RuleDelta[] between the extract and apply voice-merge phases.
-- Apply manually: psql "<DATABASE_URL>" -f 0037_content_cycles.sql

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_cycles" (
  "id"                  uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"           uuid      NOT NULL REFERENCES "clients"("id"),
  "channel"             text      NOT NULL,
  "cycle_month"         text      NOT NULL,        -- YYYY-MM
  "status"              text      NOT NULL DEFAULT 'scheduled',
  "prior_status"        text,                      -- set on →failed; cleared on retry
  "intake_source"       text,                      -- 'reply' | 'confirmed' | 'fallback' | null
  "intake_json"         jsonb,                     -- structured client intake; null until captured
  "lean_line"           text,
  "draft_csv_ref"       text,                      -- Drive file ID of draft CSV
  "workbook_ref"        text,                      -- Drive file ID of built workbook
  "pending_deltas_json" jsonb,                     -- RuleDelta[] stored between extract and apply phases
  "request_sent_at"     timestamp,
  "reminded_at"         timestamp,
  "reply_received_at"   timestamp,
  "delivered_at"        timestamp,
  "finalised_at"        timestamp,
  "voice_merged_at"     timestamp,
  "closed_at"           timestamp,
  "failed_step"         text,                      -- which step set status='failed'
  "created_at"          timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_cycles_unique"
  ON "content_cycles" ("client_id", "channel", "cycle_month");
