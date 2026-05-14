---
phase: 02-engine-first-workflow
plan: 01
type: summary
completed: 2026-05-12
duration: ~1 session
---

# Summary: 02-01 — @sprigly/engine orchestration layer

## What Was Built

Full engine orchestration layer replacing all `// TODO` stubs.

**Files created/modified:**
- `engine/packages/engine/src/types.ts` — removed TODO comment (types already correct)
- `engine/packages/engine/src/workflow-registry.ts` — Map-backed Workflow registry (register/get/getAll)
- `engine/packages/engine/src/event-router.ts` — DB query + MatchCondition evaluation; pure functions exported for testing
- `engine/packages/engine/src/workflow-runner.ts` — workflow_run row lifecycle + WorkflowContext assembly + DB event→engine event conversion
- `engine/packages/engine/src/destination-dispatcher.ts` — delivery loop; creates approvals row instead of delivering when requiresApproval
- `engine/packages/engine/src/event-router.test.ts` — 17 unit tests covering all ops (equals, contains, startsWith, endsWith, regex), case sensitivity, empty conditions
- `engine/packages/engine/src/index.ts` — full re-exports replacing `export {}` stub
- `engine/packages/engine/package.json` — added `drizzle-orm: ^0.30.0`
- `engine/packages/engine/vitest.config.ts` — sets dummy DATABASE_URL so DB module loads during pure unit tests
- `engine/packages/prompts/src/index.ts` — DbPromptResolver with client-specific → global (null clientId) fallback
- `engine/packages/prompts/package.json` — added `drizzle-orm: ^0.30.0`

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: engine type-checks clean | ✓ PASS | `tsc --noEmit` exits 0 |
| AC-2: prompts type-checks clean | ✓ PASS | `tsc --noEmit` exits 0 |
| AC-3: condition evaluation tests | ✓ PASS | 17 tests, all pass |
| AC-4: EventRouter returns rules in priority order | ✓ PASS | `ORDER BY priority DESC`, filtered by condition evaluation |
| AC-5: WorkflowRunner creates/updates workflow_run | ✓ PASS | insert on start, update on complete/fail/ignored |
| AC-6: DestinationDispatcher creates approval row | ✓ PASS | inserts approvals row; skips deliver() when requiresApproval |
| AC-7: DbPromptResolver falls back to global template | ✓ PASS | queries client-specific first, falls back to isNull(clientId) |

## Decisions Made

- **vitest.config.ts with dummy DATABASE_URL** — `@sprigly/db`'s client.ts validates DATABASE_URL via Zod at module load time. Pure unit tests (no DB calls) still trigger this because they import from event-router.ts which imports from @sprigly/db. Setting a non-connecting dummy URL satisfies Zod without needing a real DB for unit tests.
- **drizzle-orm as direct dep** — same lesson as oauth-tokens: `eq`/`and`/`desc`/`isNull` imports from drizzle-orm fail type-check if only available transitively through @sprigly/db.
- **`evaluateCondition` / `evaluateConditions` / `extractField` are exported pure functions** — not methods on EventRouter — so they can be unit tested without a DB instance.
- **exactOptionalPropertyTypes fix in toEngineEvent** — `structured` is optional in IncomingEvent.content, so assigned using spread conditional: `...(structured !== undefined && { structured })`.
- **WorkflowRunner takes dbEventId string, not the row** — cleaner API for the worker (02-05) which will receive event IDs from the BullMQ queue payload.
- **DestinationDispatcher.dispatch errors are logged, not thrown** — one failing destination should not block others.

## Deferred Issues

None. All AC met.

## Next Plan

02-02: `packages/sources/email-gmail` — Gmail poller + body parser + idempotency
