---
phase: 02-engine-first-workflow
plan: 03
type: summary
completed: 2026-05-12
duration: ~1 session
---

# Summary: 02-03 — @sprigly/workflows (blog-post workflow)

## What Was Built

`@sprigly/workflows` with the `sprigly-blog-post` three-model-call pipeline.

**Files created/modified:**
- `engine/packages/workflows/src/sprigly-blog-post/types.ts` — `BlogPostInput`, `BlogPostOutput`, `ResearchResponse`, `StructureResponse`
- `engine/packages/workflows/src/sprigly-blog-post/parse-input.ts` — `parseBlogPostInput(event)` pure function
- `engine/packages/workflows/src/sprigly-blog-post/slug.ts` — `generateSlug(title)` pure function
- `engine/packages/workflows/src/sprigly-blog-post/sprigly-blog-post.ts` — `spriglyBlogPostWorkflow` object: research → structure → write pipeline
- `engine/packages/workflows/src/sprigly-blog-post/sprigly-blog-post.test.ts` — 19 tests
- `engine/packages/workflows/src/index.ts` — re-exports replacing `export {}` stub
- `engine/packages/workflows/vitest.config.ts` — dummy DATABASE_URL

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: type-check clean | ✓ PASS | `tsc --noEmit` exits 0 |
| AC-2: parseInput triggers | ✓ PASS | 8 tests: case-insensitive, trims, empty → null, wrong prefix → null, fallback to structured |
| AC-3: generateSlug | ✓ PASS | 5 tests: lowercase, special chars stripped, hyphens normalised |
| AC-4: exactly 3 model calls | ✓ PASS | verified with vi.fn() call count |
| AC-5: output shape complete | ✓ PASS | all fields checked including author from clientConfig |

## Decisions Made

- **`extractJson` strips markdown code fences** — models often wrap JSON in ` ```json ``` ` fences; the helper extracts the inner content before `JSON.parse`. Tested explicitly with a code-fence fixture.
- **All engine imports are `import type`** — no runtime dep on `@sprigly/engine` or `@sprigly/db`; vitest.config.ts is defensive only.
- **Model ID from `clientConfig.settings['model']`** — configurable per client; falls back to `claude-haiku-4-5-20251001` (fast/cheap, appropriate for dev).
- **Fallback defaults on all structured fields** — `?? ''` / `?? 'General'` / `?? []` throughout; if a model returns partial JSON the workflow still produces a valid `BlogPostOutput` rather than crashing.
- **19 tests pass on first run** — no fixture corrections needed.

## Deferred Issues

- Prompt templates (`'research'`, `'structure'`, `'write'` step names) not yet seeded — Plan 02-04 handles this.
- Slug collision handling not in the workflow — the destination (Plan 02-04) appends a suffix if the slug already exists.

## Next Plan

02-04: `packages/destinations` — db-save-blog-post + gmail-send-notification + seed routing rules + prompt templates
