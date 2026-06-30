--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "triage_capture_log" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"         uuid NOT NULL REFERENCES "clients"("id"),
  "event_id"          uuid NOT NULL REFERENCES "incoming_events"("id"),
  "workflow_run_id"   uuid NOT NULL REFERENCES "workflow_runs"("id"),
  "category"          text NOT NULL,
  "suggested_action"  text NOT NULL,
  "draft_text"        text,
  "escalation_reason" text,
  "decision"          text,
  "correction_type"   text,
  "final_action"      text,
  "final_text"        text,
  "decided_at"        timestamp,
  "decided_by"        uuid REFERENCES "users"("id"),
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "updated_at"        timestamp NOT NULL DEFAULT now()
);
