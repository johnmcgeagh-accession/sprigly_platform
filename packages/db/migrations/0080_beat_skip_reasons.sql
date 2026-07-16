-- 0080_beat_skip_reasons — per-beat skip reason for the intake-capture reminder send log.
--
-- Records WHY a reminder touch (Ask / Nudge / Last Call) left its *_sent_at NULL, so the state
-- is recoverable from the DB alone. A NULL *_sent_at cannot distinguish a suppressed beat (input
-- landed) from an attempted-but-unsent one (send failed, no sender configured, an error). These
-- three columns sit alongside ask_sent_at / nudge_sent_at / last_call_sent_at (migration 0076)
-- and are written on the SKIP branches of the sender; they NEVER gate sending — the at-most-once
-- guard keys off *_sent_at only, unchanged.
--
-- Values: 'has_input' | 'send_failed' | 'no_sender_wired' | 'error'. Nullable, no default, no
-- CHECK (house style, cf. ig_input_status). NULL = unknown / predates the column — NOT
-- backfillable; existing rows stay NULL and the readout renders that as "No reminder sent".
--
-- Additive and non-destructive: adds nullable columns only; no backfill, no default, no data
-- touched. APPLY-BEFORE-DEPLOY. Apply manually:
--   psql "<DATABASE_URL>" -f 0080_beat_skip_reasons.sql

ALTER TABLE "content_cycles" ADD COLUMN IF NOT EXISTS "ask_skip_reason"       text;
ALTER TABLE "content_cycles" ADD COLUMN IF NOT EXISTS "nudge_skip_reason"     text;
ALTER TABLE "content_cycles" ADD COLUMN IF NOT EXISTS "last_call_skip_reason" text;
