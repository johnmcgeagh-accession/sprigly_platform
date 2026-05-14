---
phase: 01-foundations
plan: 04
type: summary
completed: 2026-05-12
duration: ~2 sessions
---

# Summary: 01-04 — @sprigly/oauth-tokens

## What Was Built

Full `@sprigly/oauth-tokens` package implementing envelope encryption for OAuth tokens.

**Files created/modified:**
- `src/types.ts` — `OAuthProvider`, `OAuthTokenBundle`, `EncryptionProvider` interface
- `src/crypto.ts` — AES-256-GCM `encrypt`/`decrypt` using Node built-in `crypto`
- `src/providers.ts` — `KmsProvider`, `LocalDevProvider`, `createEncryptionProvider()` factory
- `src/store-tokens.ts` — `storeTokens(db, encProvider, clientId, oauthProvider, tokens)`
- `src/get-tokens.ts` — `getTokens(db, encProvider, clientId, oauthProvider)` → `OAuthTokenBundle | null`
- `src/crypto.test.ts` — 4 Vitest tests covering round-trip, random IV, wrong key, bad key length
- `src/index.ts` — re-exports
- `package.json` — added `drizzle-orm: ^0.30.0` (was missing as direct dep)

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: type-check clean | ✓ PASS | `tsc --noEmit` exits 0 |
| AC-2: AES-256-GCM round-trip | ✓ PASS | 4 crypto tests pass |
| AC-3: Local dev provider end-to-end | ✓ PASS | Smoke test with LocalDevProvider confirmed store+retrieve |
| AC-4: KMS provider type-safe | ✓ PASS | KmsProvider compiles; GenerateDataKey/Decrypt called correctly |
| AC-5: Factory picks correct provider | ✓ PASS | KMS smoke test passed with `✓ PASS` |

## Decisions Made

- **Select-then-insert/update pattern** for `storeTokens` — oauth_connections has no composite unique on (clientId, provider), so `onConflictDoUpdate` not possible without a migration. Deferred to a future migration if upsert semantics become important.
- **`drizzle-orm` as direct dep** — `eq`/`and` imports fail at type-check if it's only a peer dep through `@sprigly/db`. Added explicitly.
- **AWS_KMS_KEY_ID duplicate in .env.local** — the Bedrock section on line 16 already had the key; the Encryption section on line 26 had a blank re-declaration that overrode it. Removed the duplicate; KEY_ID lives with the AWS credentials block.
- **LOCAL_DEV_ENCRYPTION_KEY regenerated** — the placeholder value `change-me-32-chars-minimum-please!!` is not 32-byte base64. Replaced with a proper `randomBytes(32).toString('base64')` value.
- **AWS KMS CHECKPOINT: DONE** — KMS path tested and verified (`✓ PASS` with AWS_KMS_KEY_ID set). Node v20 warning about SDK v3 post-2027 support is non-blocking.

## Deferred Issues

None. AWS KMS checkpoint was completed (not deferred).

## Phase 1 Status

All four foundations plans are complete:
- 01-01: Monorepo scaffold ✓
- 01-02: Database + migrations ✓
- 01-03: Model client + audit logger ✓
- 01-04: OAuth token encryption ✓

**Phase 1 is complete. Next: Phase 2 — Engine + First Workflow.**
