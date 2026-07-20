-- 0087_draft_approval — record that a draft month was approved, and by whom. (Build D.)
--
-- Approval is the moment a proposal becomes a commitment: draft rows transition to
-- 'generating' and phase 2 spends real money generating captions, hooks and scripts. That
-- transition needs to be attributable after the fact, which two nullable columns give us:
--
--   approved_at — when. NULL means never approved (still a draft, or no draft at all).
--   approved_by — 'client' (they pressed the button) or 'auto' (D3: the cutoff arrived and
--                 we went ahead, as the plan doc commits us to). The distinction drives
--                 the plan-ready email copy, and matters more than it looks: telling a
--                 client "you approved this" when they did not would be a small lie with
--                 a long tail.
--
-- No CHECK constraint on approved_by — verified against pg_constraint that content_cycles
-- carries NONE today (unlike email_templates, which had one and rejected the 0085 insert).
-- Adding the table's first CHECK for this column alone would be inconsistent with how
-- every other domain on this table is enforced (in TypeScript).
--
-- Additive and non-destructive: two nullable columns, no backfill, no defaults, no data
-- touched. Existing cycles read as never-approved, which is true — none went through an
-- approval that did not exist. APPLY-BEFORE-DEPLOY: content_cycles is read with select()
-- in several places, so the columns must exist before the schema change deploys.
--
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0087_draft_approval.sql

ALTER TABLE "content_cycles" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
ALTER TABLE "content_cycles" ADD COLUMN IF NOT EXISTS "approved_by" text;
