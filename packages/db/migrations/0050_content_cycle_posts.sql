-- content_cycle_posts: structured per-post representation of a generated plan —
-- the backbone the client app (@sprigly/app) reads and (Phase 2+) edits. Written
-- by the planning worker as an ADDITIVE dual-write alongside the existing
-- CSV → xlsx → Drive path (CSV stays the live delivery + safety net), and
-- backfilled once from the current workbook. source_meta keeps every CSV column
-- losslessly so the workbook pipeline is unaffected.
--
-- No UNIQUE on (cycle_id, position): batch reorders need transient collisions to
-- be fine — position is an unconstrained sort key. updated_at bumps on every write
-- via the trigger below (default now() only covers INSERT).
-- Apply manually: psql "<DATABASE_URL>" -f 0050_content_cycle_posts.sql

CREATE TABLE IF NOT EXISTS "content_cycle_posts" (
  "id"             uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "updated_at"     timestamp NOT NULL DEFAULT now(),
  "cycle_id"       uuid      NOT NULL REFERENCES "content_cycles"("id"),
  "client_id"      uuid      NOT NULL REFERENCES "clients"("id"),
  "channel"        text      NOT NULL,
  "scheduled_date" date      NOT NULL,
  "format"         text      NOT NULL,
  "pillar"         text,
  "caption"        text,
  "status"         text      NOT NULL DEFAULT 'planned',
  "script"         text,
  "overlay"        text,
  "position"       integer   NOT NULL DEFAULT 0,
  "source_meta"    jsonb
);

CREATE INDEX IF NOT EXISTS "content_cycle_posts_cycle_date_idx"
  ON "content_cycle_posts" ("cycle_id", "scheduled_date");

-- updated_at bump on every UPDATE (the default now() only fires on INSERT).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "content_cycle_posts_set_updated_at" ON "content_cycle_posts";
CREATE TRIGGER "content_cycle_posts_set_updated_at"
  BEFORE UPDATE ON "content_cycle_posts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
