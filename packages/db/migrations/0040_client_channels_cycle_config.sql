ALTER TABLE "client_channels"
  ADD COLUMN "instagram_handle" text,
  ADD COLUMN "contact_email" text,
  ADD COLUMN "contact_name" text,
  ADD COLUMN "content_cycle_schedule" jsonb,
  ADD COLUMN "extra_questions" jsonb;
