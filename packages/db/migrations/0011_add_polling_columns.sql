-- Adds polling_mode and last_polled_at to oauth_connections if they do not
-- already exist. Guards are present because 0010_selective_polling.sql may
-- have been recorded in __drizzle_migrations without its DDL actually running.

--> statement-breakpoint

ALTER TABLE "oauth_connections"
  ADD COLUMN IF NOT EXISTS "polling_mode" text NOT NULL DEFAULT 'selective'
    CONSTRAINT "oauth_connections_polling_mode_check"
    CHECK ("polling_mode" IN ('selective', 'full'));

--> statement-breakpoint

ALTER TABLE "oauth_connections"
  ADD COLUMN IF NOT EXISTS "last_polled_at" timestamp DEFAULT NOW();

--> statement-breakpoint

UPDATE "oauth_connections"
SET
  "polling_mode"   = 'selective',
  "last_polled_at" = NOW()
WHERE "provider" = 'gmail'
  AND "last_polled_at" IS NULL;
