-- 0060: content_cycles.posts_sync_status — health of the content_cycle_posts write
-- for the cycle's latest plan run, so a failed posts-write is VISIBLE instead of
-- silently serving a stale plan to the client app.
--
-- Values: 'synced' (posts match the plan), 'out_of_sync' (the posts-write failed;
-- the workbook/CSV are fine but the app is stale), NULL (never run / legacy).
--
-- Set by planning.ts: 'synced' on a successful merge-write; 'out_of_sync' in the
-- catch (logged at ERROR, run continues so the workbook survives — never silent).
-- Surfaced in the admin cycle-status block (ContentCycleOpsPanel).
--
-- APPLY-BEFORE-DEPLOY (same ordering as 0058): the column is mapped in the Drizzle
-- schema, so select().from(content_cycles) references posts_sync_status. Apply this
-- before the code that maps it deploys.
-- Apply manually: psql "<DATABASE_URL>" -f 0060_cycle_posts_sync_status.sql

ALTER TABLE "content_cycles"
  ADD COLUMN IF NOT EXISTS "posts_sync_status" text;
