-- Reverse of 0078_ask_template_v2.sql (LOCAL / emergency ONLY). Re-points publication to ask v1
-- and drops ask v2. Apply manually:  psql "<DATABASE_URL>" -f 0078_ask_template_v2.down.sql

UPDATE "email_templates" SET "is_published" = false WHERE "key" = 'ask' AND "version" = 2;
UPDATE "email_templates" SET "is_published" = true  WHERE "key" = 'ask' AND "version" = 1;
DELETE FROM "email_templates" WHERE "key" = 'ask' AND "version" = 2;
