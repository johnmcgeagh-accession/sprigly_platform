--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_channels" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"       timestamp NOT NULL DEFAULT now(),
  "updated_at"       timestamp NOT NULL DEFAULT now(),
  "client_id"        uuid NOT NULL REFERENCES "clients"("id"),
  "channel"          text NOT NULL,          -- 'instagram', 'linkedin', etc.
  "inbound_address"  text,                   -- expected sender email for return-xlsx validation (optional guard)
  "drive_folder_id"  text,                   -- Google Drive folder ID for this channel's calendar files
  "status"           text NOT NULL DEFAULT 'active',
  CONSTRAINT "client_channels_unique" UNIQUE ("client_id", "channel")
);
