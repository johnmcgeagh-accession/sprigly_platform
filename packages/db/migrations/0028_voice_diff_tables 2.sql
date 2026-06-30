-- Voice diff persistence: immutable ledger of caption edits, versioned snapshots,
-- and per-ingestion run tracking. voice.md becomes a derived artifact regenerable
-- from voice_snapshots. Rollback = select an earlier snapshot row and re-write disk.
--
-- Table creation order avoids forward FK references:
--   1. voice_snapshots   (references only clients)
--   2. voice_ingestion_runs (references clients + voice_snapshots, snapshot_id nullable)
--   3. voice_edits       (references clients + voice_ingestion_runs)

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_snapshots" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now(),
  "client_id"    uuid NOT NULL REFERENCES "clients"("id"),
  "channel"      text NOT NULL,
  "snapshot_md"  text NOT NULL,       -- full content of the channel block in voice.md at this point
  "reason"       text NOT NULL,       -- 'monthly-ingest' | 'manual-override' | 'rollback' | 'initial'
  "source_month" text,                -- YYYY-MM that produced this snapshot; null for initial/manual
  "run_id"       uuid,                -- FK to voice_ingestion_runs.id; wired after that table exists
  "is_current"   boolean NOT NULL DEFAULT false
);

-- Exactly one snapshot per (client_id, channel) may be current at any time.
-- voice:ingest sets is_current=true on the new row and false on the previous one
-- atomically. Rollback sets is_current=true on the target row and false on all others.
-- Without this index, two rows could be marked current and voice.md would regenerate
-- from an ambiguous source.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_snapshots_one_current"
  ON "voice_snapshots" ("client_id", "channel")
  WHERE "is_current";

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_ingestion_runs" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "updated_at"  timestamp NOT NULL DEFAULT now(),
  "client_id"   uuid NOT NULL REFERENCES "clients"("id"),
  "channel"     text NOT NULL,
  "month"       text NOT NULL,    -- YYYY-MM from xlsx filename
  "status"      text NOT NULL DEFAULT 'running',  -- running | completed | failed
  "edit_count"  integer,
  "edit_rate"   numeric(5,2),     -- fraction of posts edited, e.g. 0.33
  "snapshot_id" uuid REFERENCES "voice_snapshots"("id"),   -- set on completion
  "error"       text,
  "started_at"  timestamp NOT NULL DEFAULT now(),
  "ended_at"    timestamp
);

-- Prevent two completed runs for the same client/channel/month.
-- Failed and running rows are not covered — retries are allowed.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_ingestion_runs_unique_month"
  ON "voice_ingestion_runs" ("client_id", "channel", "month")
  WHERE "status" = 'completed';

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_edits" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"       timestamp NOT NULL DEFAULT now(),
  "updated_at"       timestamp NOT NULL DEFAULT now(),
  "client_id"        uuid NOT NULL REFERENCES "clients"("id"),
  "channel"          text NOT NULL,        -- e.g. 'instagram'
  "month"            text NOT NULL,        -- YYYY-MM (derived from xlsx filename via extract_edits.py)
  "post_index"       integer,              -- 1-based row position in edit JSON array; null if not tracked
  "date"             text,                 -- e.g. '16 Jul'
  "post_title"       text,
  "category"         text,
  "pillar"           text,
  "sprigly_draft"    text,
  "contact_amended"  text,                 -- null when blank (client approved draft as-is)
  "notes"            text,
  "ingestion_run_id" uuid NOT NULL REFERENCES "voice_ingestion_runs"("id")
);

-- Fast lookup for "all edits for a client/channel/month" (used by voice:ingest).
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_edits_client_channel_month"
  ON "voice_edits" ("client_id", "channel", "month");

-- Back-fill run_id FK on voice_snapshots now that voice_ingestion_runs exists.
--> statement-breakpoint
ALTER TABLE "voice_snapshots"
  ADD CONSTRAINT "voice_snapshots_run_fk"
  FOREIGN KEY ("run_id") REFERENCES "voice_ingestion_runs"("id");
