--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "triage_seen_messages" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"   uuid NOT NULL REFERENCES "clients"("id"),
  "message_id"  text NOT NULL,
  "thread_id"   text NOT NULL,
  "outcome"     text NOT NULL,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "updated_at"  timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "triage_seen_messages_unique"
  ON "triage_seen_messages" ("client_id", "message_id");
