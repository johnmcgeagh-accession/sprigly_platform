-- 0058: structured_brief — the parsed, structured form of a cycle's planning brief
-- (intake_json.planContent → StructuredBrief), produced by the brief extractor
-- (engine/src/content-cycles/brief-extract.ts). Persisted once per cycle and
-- re-read on regen so the extraction is not re-run every plan.
--
-- PHASE 1 adds the column ONLY. No code writes or reads it yet: the extractor is
-- not wired into the planning pipeline, and the Drizzle schema (packages/db) does
-- NOT yet map this column — deliberately, so that `select().from(content_cycles)`
-- keeps working before/after apply. Wiring (schema mapping + read/write) is a
-- later phase, and this migration must be applied BEFORE that wiring deploys.
--
-- Shape: StructuredBrief (packages/engine/src/types.ts) —
--   { products: BriefProduct[], schedule: BriefScheduleBeat[], focus: string[],
--     plan_window: { from, month } }
-- Nullable: NULL = not yet extracted for this cycle.
-- Apply manually: psql "<DATABASE_URL>" -f 0058_cycle_structured_brief.sql

ALTER TABLE "content_cycles"
  ADD COLUMN IF NOT EXISTS "structured_brief" jsonb;
