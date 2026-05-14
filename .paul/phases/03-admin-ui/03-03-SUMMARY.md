---
phase: 03-admin-ui
plan: 03
type: summary
completed: 2026-05-13
duration: ~1 session
---

# Summary: 03-03 — Prompt template editor with version history

## What Was Built

Prompt template editor with immutable version history — list latest versions grouped by workflow, detail/edit page with sidebar version navigation, Server Action that always inserts a new version row rather than updating existing ones.

**Files created:**
- `engine/apps/web/src/app/admin/prompts/page.tsx` — list: all templates deduplicated to latest version per (clientId, workflowId, stepName), grouped by workflowId; leftJoin on clients for name
- `engine/apps/web/src/app/admin/prompts/[id]/page.tsx` — two-column layout: main (current prompt text in scrollable pre block + edit textarea form) + sticky sidebar (version history list, current version highlighted)
- `engine/apps/web/src/app/admin/prompts/actions.ts` — `saveNewVersion`: fetches source row, queries `max(version)`, inserts with version+1, revalidates, redirects to new row's detail page

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: List page grouped by workflow | ✓ PASS | Three templates visible under sprigly-blog-post |
| AC-2: Detail with text + version history | ✓ PASS | Two-column layout, sidebar with version links |
| AC-3: Save creates new version | ✓ PASS | v2 row inserted, redirect to new detail page |
| AC-4: Type-check clean | ✓ PASS | `tsc --noEmit` exits 0 |

## Decisions Made

- **Immutable version pattern**: `saveNewVersion` always INSERTs — never updates. Max version is queried fresh each save to handle concurrent edits safely.
- **JS deduplication on list page**: `DISTINCT ON` is not available in Drizzle 0.30 without raw SQL. Fetching all versions ordered DESC and filtering with a `Set` is clean enough for the number of templates in v0.1.
- **`isNull()` for global templates**: `clientId` is nullable (global templates have no client). The version history query uses `isNull(promptTemplates.clientId)` when `source.clientId` is null — Drizzle's `isNull()` helper from `drizzle-orm`.
- **`leftJoin` on list page**: Global templates (clientId=null) still appear; `t.clientName ?? 'global'` handles the null display.
- **`sticky top-8` sidebar**: Version history stays in view while editing long prompts — no JS needed, pure CSS.
- **`nextVersion` derived from `versions[0]?.version`**: The version history query is already ordered DESC, so the first element is always the current max. Button label "Save as v{nextVersion}" is accurate without a separate query.

## Deferred Issues

- No delete version — intentional; immutable history. Versions are permanent.
- No diff view between versions — out of scope for v0.1.
- No create-from-scratch form — new step templates added via seed or DB; admin editor is edit-only for now.
- JS deduplication on list page could be replaced with a raw SQL `DISTINCT ON` query if template volume grows.

## Next Plan

03-04: Events list, approvals queue, audit log pages
