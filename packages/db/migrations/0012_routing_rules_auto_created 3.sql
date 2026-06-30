-- Adds auto_created flag to routing_rules so the mode-switch logic can
-- distinguish rules it manages from manually-authored rules.
-- Existing rules default to false (manual).

--> statement-breakpoint

ALTER TABLE "routing_rules"
  ADD COLUMN "auto_created" boolean NOT NULL DEFAULT false;
