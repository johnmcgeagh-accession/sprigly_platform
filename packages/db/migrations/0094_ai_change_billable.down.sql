-- 0094 DOWN — LOCAL / emergency only.
--
-- Drops the billing marker. Lossy in one direction that matters: every row written while 0094
-- was applied loses whether it was exempt, and nothing else in the row records it — `actor` is
-- close but wrong on exactly the recovery paths (see the up migration). Reversing therefore
-- makes the system fan-out countable against client allowances again, which is the defect
-- 0094 exists to close.
--
-- post_edits_actor_check is deliberately untouched: 0094 never modified it.

DROP INDEX IF EXISTS "post_edits_exempt_idx";

ALTER TABLE "post_edits" DROP COLUMN IF EXISTS "billable";
