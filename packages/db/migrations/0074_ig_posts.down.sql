-- Reverse of 0074_ig_posts.sql (LOCAL / emergency ONLY).
-- Drops the ig_posts table. Only safe once nothing reads/writes it — i.e. after the
-- IG-re-homing code change is reverted. Apply manually: psql "<DATABASE_URL>" -f 0074_ig_posts.down.sql

DROP TABLE IF EXISTS "ig_posts";
