-- Reverse 0093: put v1 back on air.
--
-- ORDER MATTERS and is the mirror of the forward file: `email_templates_published_key` is a
-- UNIQUE index on (key) WHERE is_published, so v2 has to come down before v1 goes back up.
-- Both in one transaction, or a failure between them leaves the key with NO published row and
-- every plan-ready send logging "no published template for key — not sent".
--
-- v2 is UNPUBLISHED, never deleted: it is the record of what was sent while it was live.
BEGIN;

UPDATE "email_templates" SET "is_published" = false
 WHERE "key" IN ('plan_ready', 'plan_ready_auto') AND "version" = 2;

UPDATE "email_templates" SET "is_published" = true
 WHERE "key" IN ('plan_ready', 'plan_ready_auto') AND "version" = 1;

COMMIT;
