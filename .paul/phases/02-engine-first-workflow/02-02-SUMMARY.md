---
phase: 02-engine-first-workflow
plan: 02
type: summary
completed: 2026-05-12
duration: ~1 session
---

# Summary: 02-02 — @sprigly/sources (Gmail poller)

## What Was Built

Full Gmail source implementation within `@sprigly/sources`.

**Files created/modified:**
- `engine/packages/sources/src/gmail/gmail-parser.ts` — pure functions: `decodeBase64Url`, `stripHtml`, `getHeader`, `extractTextFromParts`, `extractMessageText`, `parseReceivedAt`
- `engine/packages/sources/src/gmail/gmail-parser.test.ts` — 22 unit tests covering all parser functions
- `engine/packages/sources/src/gmail/gmail-client.ts` — `GmailApiClient` wrapping `googleapis` with OAuth2 token refresh event
- `engine/packages/sources/src/gmail/gmail-poller.ts` — `GmailPoller.poll(clientId)` — idempotent event creation via `processed_external_ids`
- `engine/packages/sources/src/index.ts` — re-exports replacing `export {}` stub
- `engine/packages/sources/package.json` — added `googleapis: ^144.0.0`, `drizzle-orm: ^0.30.0`
- `engine/packages/sources/vitest.config.ts` — dummy DATABASE_URL for test isolation

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: type-check clean | ✓ PASS | `tsc --noEmit` exits 0 |
| AC-2: parser unit tests | ✓ PASS | 22/22 tests pass |
| AC-3: idempotency | ✓ PASS | `processed_external_ids` checked before each message |
| AC-4: incoming event shape | ✓ PASS | source='email', sourceMetadata with all headers, content.text, externalId |
| AC-5: token refresh stored back | ✓ PASS | googleapis `tokens` event → `storeTokens` via callback |

## Decisions Made

- **`markAsRead` uses `.catch(() => undefined)`** — best-effort only; failure doesn't break the poll loop and idempotency doesn't depend on it.
- **`processedExternalIds` inserted before `incomingEvents`** — crash-safe ordering: if crash between the two, next poll skips the message (silent loss) rather than creating a duplicate event.
- **`googleapis` `tokens` event returns `refresh_token: string | null | undefined`** — `null` must be excluded explicitly (`typeof x === 'string'` guard); `!== undefined` alone lets null through and breaks `exactOptionalPropertyTypes`.
- **Test fixture bug fixed** — initial test expected pre-trim/pre-collapse output from `stripHtml`; corrected to match actual (correct) trimmed/collapsed behaviour.
- **`void onTokensRefreshed(refreshed)`** — event emitter cannot await async callbacks; errors in token storage are swallowed to avoid crashing the polling process.

## Deferred Issues

None.

## Next Plan

02-03: `packages/workflows/sprigly-blog-post` — three-model-call blog pipeline
