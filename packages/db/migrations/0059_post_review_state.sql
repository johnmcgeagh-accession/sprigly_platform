-- 0059: content_cycle_posts.review_state — regen-merge provenance for each post,
-- so the client app can distinguish posts kept from the client's own prior work
-- from freshly regenerated ones.
--
-- Values: 'preserved_edit' (kept from client work), 'preserved_edit_orphan' (kept
-- but names a product no longer in the brief — needs accept/remove), 'regenerated'
-- (fresh from the new plan), NULL (pre-existing / unclassified).
--
-- Written by the edit-aware regen merge (planning.ts) and the merge-apply CLI.
-- Orthogonal to `status` (planned/edited/new), which drives the app's edit UI.
--
-- APPLY-BEFORE-DEPLOY (same ordering as 0058): the column is now mapped in the
-- Drizzle schema, so select().from(content_cycle_posts) references review_state.
-- This migration MUST be live on the DB before the code that maps it deploys, or
-- all content_cycle_posts reads (app plan render, mutations, planning merge) error
-- with "column review_state does not exist".
-- Apply manually: psql "<DATABASE_URL>" -f 0059_post_review_state.sql

ALTER TABLE "content_cycle_posts"
  ADD COLUMN IF NOT EXISTS "review_state" text;
