--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "triage_configs" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"               uuid NOT NULL REFERENCES "clients"("id"),
  "categories"              jsonb NOT NULL DEFAULT '[]',
  "voice_sample"            text NOT NULL DEFAULT '',
  "reply_examples"          jsonb NOT NULL DEFAULT '[]',
  "additional_instructions" text,
  "created_at"              timestamp NOT NULL DEFAULT now(),
  "updated_at"              timestamp NOT NULL DEFAULT now()
);
