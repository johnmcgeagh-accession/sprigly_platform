-- 0091 DOWN — LOCAL / emergency only.
--
-- Narrows cost_pence back to integer. This is LOSSY in exactly the way the up migration exists
-- to fix: every sub-penny cost written while 0091 was applied is rounded on the way back, and
-- the distinction between a 0.55p parse turn and a 0.00008p embed is destroyed permanently.
--
-- The rounding here is ROUND, not the ceil the old code applied. That is deliberate: ceil was
-- the bug, and reproducing it on the way down would inflate the reversed history rather than
-- merely coarsen it. A reversal should lose precision, not invent spend. Note the consequence —
-- every sub-half-penny row becomes 0, which reads as free rather than as cheap. There is no
-- integer column that can say "cheap"; that is the whole reason for the up migration.

ALTER TABLE "audit_log"
  ALTER COLUMN "cost_pence" TYPE integer USING round("cost_pence")::integer;
