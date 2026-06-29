-- planning_trace: diagnostic, per-step record of the planning validation loop
-- (gate / critic / repair / catalogue) for ONE cycle. Captures what every repair
-- actually changed (caption_before → caption_after), what triggered it, and the
-- token cost per call — the before/after states the audit ledger does NOT keep.
-- Purely observational: written best-effort during the loop (a write failure never
-- fails the planning run) and read back with
--   pnpm --filter @sprigly/worker planning-trace <cycleId>
--
-- One row per loop STEP. seq is a monotonic per-run ordinal so the interleaved
-- gate→repair→critic sequence (and oscillation) reconstructs exactly, even when
-- timestamps collide.
-- Apply manually: psql "<DATABASE_URL>" -f 0046_planning_trace.sql

CREATE TABLE IF NOT EXISTS "planning_trace" (
  "id"             uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "updated_at"     timestamp NOT NULL DEFAULT now(),
  "cycle_id"       uuid      NOT NULL REFERENCES "content_cycles"("id"),
  "seq"            integer   NOT NULL,
  "post_index"     integer   NOT NULL,
  "post_title"     text,
  "target_month"   text,
  "phase"          text      NOT NULL,
  "attempt"        integer,
  "pass"           boolean,
  "issues"         jsonb,
  "detail"         jsonb,
  "caption_before" text,
  "caption_after"  text,
  "input_tokens"   integer,
  "output_tokens"  integer,
  "model_id"       text
);

CREATE INDEX IF NOT EXISTS "planning_trace_cycle_idx"
  ON "planning_trace" ("cycle_id", "seq");
