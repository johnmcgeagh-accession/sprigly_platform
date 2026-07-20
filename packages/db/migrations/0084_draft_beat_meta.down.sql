-- Reverse of 0084_draft_beat_meta.sql (LOCAL / emergency ONLY).
--
-- Drops beat_meta. Only safe once nothing reads or writes it — i.e. after the Build A
-- assembler is reverted. Any draft rows themselves are NOT removed by this: they would
-- remain as status='draft' rows carrying no rationale. Delete them separately if that is
-- what you intend:
--   DELETE FROM content_cycle_posts WHERE status = 'draft';
--
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0084_draft_beat_meta.down.sql

ALTER TABLE "content_cycle_posts" DROP COLUMN IF EXISTS "beat_meta";
