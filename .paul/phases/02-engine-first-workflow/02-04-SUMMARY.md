---
phase: 02-engine-first-workflow
plan: 04
type: summary
completed: 2026-05-12
duration: ~1 session
---

# Summary: 02-04 — @sprigly/destinations + seed data

## What Was Built

`@sprigly/destinations` with two destinations, and the DB seed extended with Sprigly's clientConfig, routing rule, and prompt templates.

**Files created/modified:**
- `engine/packages/destinations/package.json` — added `googleapis`, `drizzle-orm`, `@sprigly/workflows` deps
- `engine/packages/destinations/vitest.config.ts` — dummy DATABASE_URL
- `engine/packages/destinations/src/blog-post/db-save-blog-post.ts` — `DbSaveBlogPost` destination
- `engine/packages/destinations/src/notification/compose-email.ts` — pure `composeNotificationEmail` function
- `engine/packages/destinations/src/notification/compose-email.test.ts` — 8 tests
- `engine/packages/destinations/src/notification/gmail-send-notification.ts` — `GmailSendNotification` destination
- `engine/packages/destinations/src/index.ts` — re-exports replacing `export {}` stub
- `engine/packages/db/src/seed.ts` — extended with clientConfig, routing rule, 3 prompt templates

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: type-check clean | ✓ PASS | `tsc --noEmit` exits 0 |
| AC-2: composeNotificationEmail tests | ✓ PASS | 8 tests: Subject, To, From, excerpt, keyword, authorName, Content-Type, empty excerpt |
| AC-3: slug collision handling | ✓ PASS | `findUniqueSlug` loops slug-2…slug-100, throws if exceeded |
| AC-4: Seed produces required rows | ✓ PASS | clientConfig + routing rule + 3 prompt templates seeded and verified in live DB |
| AC-5: Destinations in index with correct IDs | ✓ PASS | `db-save-blog-post` and `gmail-send-notification` exported from index |

## Decisions Made

- **`findUniqueSlug` caps at 100 attempts** — throws `Error` if exceeded (as per scope limits). Slug collision loop is async DB queries, one per attempt.
- **Nullable fields use `|| null`** — empty string → null for excerpt, metaDescription, targetKeyword, category, author, cta, researchNotes. The `faq` field (notNull with default `[]`) passes directly with a cast to `Array<Record<string, unknown>>`.
- **GmailSendNotification.requiresApproval always false** — notification is fire-and-forget, never requires approval.
- **Token refresh pattern mirrors GmailApiClient exactly** — `typeof newTokens.refresh_token === 'string'` guard, spread conditionals throughout, `let currentTokens` local variable to preserve emailAddress across refreshes.
- **`fromEmail` falls back to `toEmail`** — if `tokens.emailAddress` is undefined, the from address is the destination email. Acceptable for the v0.1 loop.
- **Seed is idempotent** — all three blocks (clientConfig, routing rule, prompt templates) select-then-skip on re-run. Safe to run multiple times.
- **tsx via `pnpm seed` script** — `../../node_modules/.bin/tsx` path doesn't exist; the correct invocation is `pnpm --filter @sprigly/db seed` from engine root (uses the db package's own devDep tsx).

## Deferred Issues

- No preview/publish token URLs in the notification email — the admin UI (Phase 3) adds those links.
- GmailSendNotification requires Gmail OAuth tokens already present in `oauth_connections` — tokens are set up via the worker setup script (02-05).
- `fromEmail` is the authenticated account's email address; for a dedicated Sprigly send address this would need a separate OAuth connection.

## Next Plan

02-05: `apps/worker` — cron poller, BullMQ queue, consumer, Gmail OAuth setup script
