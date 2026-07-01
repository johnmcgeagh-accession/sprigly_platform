-- 0052: Phase 2 — soft-delete for plan posts + per-channel delivery surface preference.
--
-- 1. content_cycle_posts.deleted_at — soft-delete (recoverable; workbook reconciliation
--    can still see a removed post). loadPlanPosts filters deleted_at IS NULL.
-- 2. client_channels.delivery_surface — what the cycle delivery email links to:
--    'both' (default: app link + workbook link), 'sheet' (workbook only — current
--    behaviour), 'app' (app link only). client_channels is the existing per-channel
--    config table, so it's the natural home.
-- Apply manually: psql "<DATABASE_URL>" -f 0052_post_soft_delete_and_delivery_pref.sql

ALTER TABLE "content_cycle_posts"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

ALTER TABLE "client_channels"
  ADD COLUMN IF NOT EXISTS "delivery_surface" text NOT NULL DEFAULT 'both';
