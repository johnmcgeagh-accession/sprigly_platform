---
phase: 01-foundations
plan: 03
subsystem: inference
tags: [anthropic-sdk, bedrock, model-client, audit, vitest, zod]

requires:
  - phase: 01-02
    provides: auditLog table + NewAuditLogEntry type from @sprigly/db

provides:
  - ModelClient interface + AnthropicClient + BedrockClient + createModelClientFromEnv
  - AuditLogger interface + DrizzleAuditLogger + computeCostPence

affects: engine, workflows, worker

tech-stack:
  added: [zod@^3.22 (model-client)]
  patterns:
    - Local interface definitions (structurally compatible with engine/types.ts)
    - Spread-based optional param handling for exactOptionalPropertyTypes compat
    - ToolInputSchema cast for Bedrock DocumentType mismatch

key-files:
  created:
    - engine/packages/model-client/src/types.ts
    - engine/packages/model-client/src/anthropic-client.ts
    - engine/packages/model-client/src/bedrock-client.ts
    - engine/packages/model-client/src/factory.ts
    - engine/packages/model-client/src/factory.test.ts
    - engine/packages/audit/src/types.ts
    - engine/packages/audit/src/price-map.ts
    - engine/packages/audit/src/audit-logger.ts
    - engine/packages/audit/src/price-map.test.ts
  modified:
    - engine/packages/model-client/src/index.ts
    - engine/packages/model-client/package.json
    - engine/packages/audit/src/index.ts

key-decisions:
  - "Types defined locally in each package — no cross-import with engine/types.ts at this stage"
  - "Bedrock ToolInputSchema: cast `as ToolInputSchema` to bypass DocumentType recursive union"
  - "Price map uses placeholder pence values clearly marked TODO"

patterns-established:
  - "Spread conditionals for optional params: `...(x !== undefined && { key: x })`"
  - "`typeof db` pattern for Drizzle client typing — avoids exposing internal postgres types"
  - "afterEach env cleanup in vitest — reset process.env between factory tests"

duration: ~30min
started: 2026-05-12T22:00:00Z
completed: 2026-05-12T22:30:00Z
---

# Phase 1 Plan 03: model-client + audit Summary

**AnthropicClient and BedrockClient (eu-west-2 Converse API) behind a unified ModelClient interface; DrizzleAuditLogger writing to audit_log with pence cost computation — 8 tests passing.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~30 min |
| Tasks | 2 completed |
| Files created | 9 |
| Files modified | 3 |
| Tests | 8 / 8 passing |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: model-client type-checks clean | Pass | tsc --noEmit exits 0 |
| AC-2: Factory produces correct client type | Pass | 4 factory tests cover all branches |
| AC-3: audit type-checks clean | Pass | tsc --noEmit exits 0 |
| AC-4: Price map returns correct pence values | Pass | 4 tests: zero for unknown, positive int, opus > sonnet, linear scaling |
| AC-5: All tests pass | Pass | 8 / 8 (4 model-client + 4 audit) |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `model-client/src/types.ts` | Created | ModelClient, ModelCompleteParams, ModelCompleteResult, AnthropicTool |
| `model-client/src/anthropic-client.ts` | Created | Anthropic SDK wrapper — Messages API |
| `model-client/src/bedrock-client.ts` | Created | Bedrock ConverseCommand wrapper — eu-west-2 |
| `model-client/src/factory.ts` | Created | createModelClientFromEnv — Zod-validated MODEL_PROVIDER switch |
| `model-client/src/index.ts` | Modified | Replaced stub — exports all types + clients + factory |
| `model-client/src/factory.test.ts` | Created | 4 factory tests (no live API calls) |
| `model-client/package.json` | Modified | Added zod dependency |
| `audit/src/types.ts` | Created | AuditLogger interface + LogModelCallParams |
| `audit/src/price-map.ts` | Created | computeCostPence — price map with TODO-marked placeholder rates |
| `audit/src/audit-logger.ts` | Created | DrizzleAuditLogger + createAuditLogger factory |
| `audit/src/index.ts` | Modified | Replaced stub — exports types + logger + price fn |
| `audit/src/price-map.test.ts` | Created | 4 price map tests (pure function, no DB) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Types defined locally, not imported from engine | model-client ↔ engine would be circular; structural typing handles compatibility | Phase 2 will wire them together; no churn expected |
| Bedrock `as ToolInputSchema` cast | `@smithy/types` DocumentType is a recursive union — `Record<string, unknown>` not assignable without cast | Single cast in bedrock-client.ts, contained |
| Spread conditionals for optional params | `exactOptionalPropertyTypes` in root tsconfig rejects `key: undefined` on required fields | Pattern to follow in all packages that use optional params |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Type cast required, contained to one line |

### Auto-fixed Issues

**1. Bedrock ToolInputSchema type mismatch**
- **Found during:** Task 1 type-check
- **Issue:** `{ json: t.input_schema as Record<string, unknown> }` fails because `DocumentType` is a recursive union that TypeScript can't verify `Record<string, unknown>` satisfies
- **Fix:** `{ json: t.input_schema } as ToolInputSchema` — cast the whole object
- **Files:** `bedrock-client.ts`
- **Verification:** type-check exits 0

## Next Phase Readiness

**Ready:**
- `import { createModelClientFromEnv } from '@sprigly/model-client'` works from any package
- `import { createAuditLogger } from '@sprigly/audit'` works; needs a Drizzle db instance
- Both interfaces (ModelClient, AuditLogger) structurally match engine/types.ts stubs
- Price map placeholder rates are in place — update before production billing

**Concerns:**
- Price map rates are placeholder — must be updated before any real usage is billed
- Bedrock model IDs in the price map (eu-west-2 inference profiles) need verification against actual available models once AWS is configured

**Blockers:**
- None — 01-04 (oauth-tokens + AWS KMS setup) can proceed

---
*Phase: 01-foundations, Plan: 03*
*Completed: 2026-05-12*
