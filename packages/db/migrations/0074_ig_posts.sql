-- ig_posts: per-(client, channel, month) Instagram post data, re-homed off Google
-- Drive (previously instagram-posts-<YYYY-MM>.json files in the client's Drive folder).
--
-- Design notes (mirrors competitor_gather_cache, migration 0042):
--   - One row per (client_id, channel, month). Latest-wins upsert (ON CONFLICT DO
--     UPDATE) — a re-trawl / re-upload of the same month replaces the array in place.
--   - posts is a JSONB array of IgPost (engine/src/lean-line.ts igPostSchema):
--     { timestamp, caption?, likesCount, commentsCount }. The writers validate it.
--   - The UNIQUE (client_id, channel, month) index also serves both readers:
--       * planning critic (loadHistoricPosts): WHERE client_id+channel ORDER BY month DESC LIMIT 2
--       * request-email lean line (fetchTopPosts): WHERE client_id+channel+month
--     so no additional index is needed (the unique's prefix + ordered scan cover them).
--
-- Additive and non-destructive: creates a new table only; touches no existing data.
-- APPLY-BEFORE-DEPLOY. Apply manually: psql "<DATABASE_URL>" -f 0074_ig_posts.sql

CREATE TABLE IF NOT EXISTS "ig_posts" (
  "id"         uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "client_id"  uuid      NOT NULL REFERENCES "clients"("id"),
  "channel"    text      NOT NULL,
  "month"      text      NOT NULL,
  "posts"      jsonb     NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "ig_posts_unique" UNIQUE ("client_id", "channel", "month")
);
