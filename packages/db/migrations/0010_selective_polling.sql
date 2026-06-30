-- Plan 04-02 commit 1: selective polling mode
--
-- Adds two columns to oauth_connections:
--   polling_mode  — 'selective' (default) or 'full'. Only 'selective' is
--                   implemented in this commit. 'full' is a placeholder for
--                   commit two.
--   last_polled_at — watermark timestamp. The poller queries Gmail for messages
--                    received after this value, replacing the is:unread query.
--                    NULL on a fresh connection; the first poll cycle sets it.
--
-- Existing connections are migrated to:
--   polling_mode  = 'selective'   (explicit, matches the column default)
--   last_polled_at = NOW()        (starts fresh from deploy; no inbox history
--                                  is replayed)

--> statement-breakpoint

ALTER TABLE "oauth_connections"
  ADD COLUMN "polling_mode" text NOT NULL DEFAULT 'selective'
    CONSTRAINT "oauth_connections_polling_mode_check"
    CHECK ("polling_mode" IN ('selective', 'full'));

--> statement-breakpoint

ALTER TABLE "oauth_connections"
  ADD COLUMN "last_polled_at" timestamp DEFAULT NOW();

--> statement-breakpoint

-- Migrate existing rows. last_polled_at = NOW() so the worker does not reach
-- back through inbox history on the first poll after this migration is applied.
UPDATE "oauth_connections"
SET
  "polling_mode"   = 'selective',
  "last_polled_at" = NOW()
WHERE "provider" = 'gmail';
