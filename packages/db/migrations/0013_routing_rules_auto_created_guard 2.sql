-- Guard re-apply of the auto_created column. 0012 was recorded in
-- __drizzle_migrations before its DDL ran (same issue as 0011).

--> statement-breakpoint

ALTER TABLE "routing_rules"
  ADD COLUMN IF NOT EXISTS "auto_created" boolean NOT NULL DEFAULT false;
