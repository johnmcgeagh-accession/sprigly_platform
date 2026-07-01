--> statement-breakpoint

ALTER TABLE "workflow_runs"
  ADD COLUMN IF NOT EXISTS "outcome" text NOT NULL DEFAULT 'handled';
