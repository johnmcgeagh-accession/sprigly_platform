ALTER TABLE "triage_capture_log"
  ADD COLUMN IF NOT EXISTS "gmail_draft_id" text;
