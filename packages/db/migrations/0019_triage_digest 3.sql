--> statement-breakpoint

ALTER TABLE "triage_configs"
  ADD COLUMN IF NOT EXISTS "digest_cadence" text NOT NULL DEFAULT 'end_of_day',
  ADD COLUMN IF NOT EXISTS "last_digest_sent_at" timestamp;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "triage_digest_tokens" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"   uuid NOT NULL REFERENCES "clients"("id"),
  "token"       text NOT NULL,
  "expires_at"  timestamp NOT NULL,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "triage_digest_tokens_token_unique" UNIQUE ("token")
);
