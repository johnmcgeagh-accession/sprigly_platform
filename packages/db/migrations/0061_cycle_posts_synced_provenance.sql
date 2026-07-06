-- 0061: make posts_sync_status HONEST and ATTRIBUTABLE.
--
-- 0060 added content_cycles.posts_sync_status but the flag could lie: it was
-- stamped 'synced' whenever the merge transaction did not throw — decoupled from
-- whether the new plan actually landed — and its 'out_of_sync' failure-stamp was
-- fire-and-forget (a failed stamp left a stale 'synced'). This migration adds the
-- provenance columns that let 'synced' be tied to a SPECIFIC verified write, and
-- widens the documented value set.
--
-- New columns (both nullable; null = legacy / never verified):
--   posts_synced_at     timestamp — when a write was VERIFIED to have landed the
--                       new plan (set only alongside status='synced'; cleared to
--                       NULL on out_of_sync/unknown).
--   posts_synced_run_id text      — the id of the write run that produced that
--                       verified sync, so 'synced' is attributable to one commit
--                       rather than being ambient. Cleared to NULL when not synced.
--
-- posts_sync_status value set (text; unchanged column) is now:
--   'synced'      — a write committed AND was verified to leave the cycle's live
--                   content_cycle_posts matching the new plan (see planning.ts).
--   'out_of_sync' — a write was attempted and failed/rolled back; the app surface
--                   is stale. Now written on a FRESH connection with one retry.
--   'unknown'     — NEW: a regen was attempted but threw BEFORE a verified write
--                   (e.g. generation failed upstream); the surface is not verified
--                   and must not be trusted as 'synced'.
--   null          — never run / pre-0060 legacy.
--
-- APPLY-BEFORE-DEPLOY (same ordering as 0058-0060): these columns are mapped in
-- the Drizzle schema, so select().from(contentCycles) emits them. Apply this
-- BEFORE the code that maps them deploys.
-- Apply manually: psql "<DATABASE_URL>" -f 0061_cycle_posts_synced_provenance.sql

ALTER TABLE "content_cycles"
  ADD COLUMN IF NOT EXISTS "posts_synced_at"     timestamp,
  ADD COLUMN IF NOT EXISTS "posts_synced_run_id" text;
