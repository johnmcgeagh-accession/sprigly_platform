-- Authoritative per-CATEGORY register map for the planning critic (Option 2).
--
-- Why: the critic was inferring register (first-person founder "I" vs brand
-- "we/our") from the historic post sample. For several categories this client's
-- real feed is register-MIXED, so different critic runs picked opposite "dominant"
-- voices and OSCILLATED (cycle c702fac2: #4 Sunday Style, #7 Care Guide, #24
-- Testimonial each flipped I<->we). Register is now GROUND TRUTH: a per-category
-- value here, resolved by plan-validation.ts resolveRegister() and handed to the
-- critic as authoritative. Categories NOT listed fall back to historic inference
-- (current behaviour) — so register-mixed categories like "Brand" are left
-- unmapped rather than forced to one voice (that would regress the I-voice
-- founder/POV posts currently filed under Brand: #18 Ours-vs-Theirs, #21 Founder
-- note). De-overloading "Brand" is a separate follow-up (see below).
--
-- This migration also SPLITS the coarse "WSG & Sunday Style" category into "WSG"
-- (founder "I") and "Sunday Style" (brand "we") — they carry opposite registers
-- and could not share one category value (that conflation drove the #4 flip).
-- No code reads the old string (gate + generation prompt are config-driven), so
-- the split propagates automatically.
--
-- Map approved 2026-06-29. No blanket default by design.
--
-- FOLLOW-UP (Option 1 — "Brand category register de-overloading"): the generator
-- files Ours-vs-Theirs and founder notes under "Brand" instead of the existing
-- "POV" / a dedicated founder category, making "Brand" register-mixed. Making the
-- taxonomy fully register-clean (and enabling a safe blanket default) requires a
-- generation-prompt change to assign register-homogeneous categories. Tracked
-- separately because it needs its own re-run verification.
--
-- Apply manually: psql "<DATABASE_URL>" -f 0048_planning_register_map.sql
--> statement-breakpoint

ALTER TABLE "client_planning_config"
  ADD COLUMN IF NOT EXISTS "register_map" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

-- Split the coarse "WSG & Sunday Style" category into two register-homogeneous
-- categories, and set the per-category register map. IVY-t / instagram only.
UPDATE "client_planning_config"
SET
  "categories" = $CATS$
["Styling", "WSG", "Sunday Style", "Brand", "Educational", "Product launch or offer related", "POV", "Testimonials", "Regular feature", "No Post/Sally"]
$CATS$::jsonb,
  "register_map" = $REG$
{
  "WSG": "I",
  "Sunday Style": "we",
  "Educational": "we",
  "Testimonials": "we",
  "Styling": "we",
  "Product launch or offer related": "we",
  "POV": "I"
}
$REG$::jsonb,
  "updated_at" = now()
WHERE "client_id" = (SELECT id FROM clients WHERE slug = 'ivy-t')
  AND "channel" = 'instagram';
