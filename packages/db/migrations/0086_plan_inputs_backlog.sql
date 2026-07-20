-- 0086_plan_inputs_backlog — the ideas backlog gains an origin, a maturity, and a
-- consumption record. (Build C, draft-plan intake arc.)
--
-- Phase 0 investigation I-5 found three gaps between what plan_inputs stores and what the
-- backlog needs. Each is a NEW column, and each for a specific reason:
--
-- 1. `origin` — NOT a reuse of `source`. `source` exists but its live domain is
--    'web' | 'voice': it records the TRANSPORT an input arrived by, not where the idea
--    came from. Overloading it with 'client' | 'competitor' would collide with both
--    existing values and with NoteView.source, which is surfaced to the client UI.
--    Two different questions deserve two columns.
--
-- 2. `lifecycle` — NOT a reuse of `status`. `status` is an AVAILABILITY axis
--    (active | expired | dismissed | integrated): is this input still live? The backlog
--    needs a MATURITY axis (candidate → used → measured → proven, plus declined/stale):
--    how well established is this idea? They are genuinely orthogonal — a 'proven' idea
--    is still 'active' — so merging them would destroy information. It also means the
--    nine readers that hardcode `status = 'active'` (enumerated in the Phase 0 report,
--    I-5 §2) keep working untouched, which repurposing `status` would have silently
--    broken: DURABLE_INPUT_TYPES is typed string[], so every drop would have been silent.
--
-- 3. `used_in_cycle_id` — nothing today records WHICH cycle consumed an input.
--    `cycle_id` is the CAPTURE cycle and is deliberately NULL for durable items;
--    `consumed_by_proposal_id` points at agent_proposals, not content_cycles. Without
--    this, a durable input is re-read by every subsequent plan month whose relevance
--    window overlaps, forever, with no record that it was ever acted on.
--
-- NO CHECK CONSTRAINTS on this table — verified against pg_constraint before writing
-- (the 0085 email_templates lesson: that table DID have one and rejected the insert).
-- plan_inputs carries only NOT NULLs, the PK and four FKs, so the new domains live in
-- TypeScript alongside the existing `type` / `status` / `source` domains.
--
-- BACKFILL: none needed beyond the column defaults. Both new text columns are NOT NULL
-- with a default, so every existing row takes 'client' / 'candidate' as it is added.
-- That is correct for the three live rows: all are type='note', all captured from the
-- client via the web surface, and none has ever been used in a cycle (used_in_cycle_id
-- stays NULL, which is the truth). No row is claimed to be more mature than it is.
--
-- Additive and non-destructive. APPLY-BEFORE-DEPLOY — plan_inputs is read with explicit
-- column lists in most places but select() elsewhere, so the columns must exist first.
-- Apply manually:
--   psql "<DATABASE_URL>" -f 0086_plan_inputs_backlog.sql

ALTER TABLE "plan_inputs" ADD COLUMN IF NOT EXISTS "origin"    text NOT NULL DEFAULT 'client';
ALTER TABLE "plan_inputs" ADD COLUMN IF NOT EXISTS "lifecycle" text NOT NULL DEFAULT 'candidate';
ALTER TABLE "plan_inputs" ADD COLUMN IF NOT EXISTS "used_in_cycle_id" uuid REFERENCES "content_cycles"("id");

-- The backlog is read by (client, lifecycle) when the allocator asks for candidates.
CREATE INDEX IF NOT EXISTS "plan_inputs_client_lifecycle_idx"
  ON "plan_inputs" ("client_id", "lifecycle");
