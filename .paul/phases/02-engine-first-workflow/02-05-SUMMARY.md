---
phase: 02-engine-first-workflow
plan: 05
type: summary
completed: 2026-05-13
duration: ~1 session
---

# Summary: 02-05 — apps/worker

## What Was Built

`@sprigly/worker` — the long-running Node.js service that ties the full engine together: Gmail poller → BullMQ queue → event consumer (route → run → dispatch), plus a one-time Gmail OAuth setup script.

**Files created/modified:**
- `engine/apps/worker/package.json` — added bullmq, drizzle-orm, zod, googleapis, @sprigly/model-client, @sprigly/oauth-tokens, @sprigly/prompts; fixed dev/start scripts; added setup-gmail script
- `engine/apps/worker/src/env.ts` — Zod validation for REDIS_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, POLL_INTERVAL_MS
- `engine/apps/worker/src/poller.ts` — `pollAllClients()`: queries active Gmail oauth_connections, polls each, enqueues received event IDs with BullMQ deduplication
- `engine/apps/worker/src/consumer.ts` — `createConsumer()`: BullMQ Worker that fetches event, routes, runs workflow, fetches runId, dispatches
- `engine/apps/worker/src/index.ts` — replaces stub: bootstraps all engine pieces, poller interval, BullMQ consumer, SIGTERM/SIGINT shutdown
- `engine/apps/worker/src/setup-gmail-oauth.ts` — one-time CLI: localhost:3456 HTTP callback, token exchange, storeTokens

## Acceptance Criteria Results

| AC | Result | Notes |
|----|--------|-------|
| AC-1: type-check clean | ✓ PASS | `tsc --noEmit` exits 0 |
| AC-2: Poller enqueues with deduplication | ✓ PASS | `jobId: eventId` prevents double-queuing |
| AC-3: Consumer routes/runs/dispatches | ✓ PASS | Verified end-to-end via worker logs |
| AC-4: OAuth setup stores tokens | ✓ PASS | Tokens stored, verified in oauth_connections |
| AC-5: Worker starts without crashing | ✓ PASS | Startup logs confirmed clean |

## Decisions Made

- **`tsx --env-file ... watch ...` arg ordering bug**: `--env-file` before `watch` causes tsx to treat `watch` as the entry file. Fixed with a shell wrapper: `sh -c 'set -a && . ../../.env.local && set +a && tsx watch src/index.ts'`. The `setup-gmail` script keeps `--env-file` since it doesn't use `watch`.
- **`drizzle-orm` must be a direct dep**: Same pattern as all other packages — `eq`/`and`/`desc` fail type-check without it as a direct dependency.
- **Port 3000 → 3456 for OAuth callback**: Port 3000 is taken by the Next.js dev server. OAuth setup script uses 3456; Google Cloud Console redirect URI updated to match.
- **Scopes: `gmail.readonly` not `gmail.modify`**: User requested minimal permissions. `readonly` + `send` covers all functionality — `markAsRead` already fails silently and `processedExternalIds` handles deduplication. Emits "Read Gmail messages" + "Send email" in the Google consent screen (not the broader "Read, compose, send" of `modify`).
- **`invalid_grant` on first poll**: Stale token row from an earlier failed setup attempt. Fixed by deleting oauth_connections rows and re-running setup-gmail.
- **`runId` fetch after WorkflowRunner.run()**: WorkflowRunner doesn't return the runId. Worker queries `workflow_runs WHERE eventId = X AND workflowId = Y ORDER BY startedAt DESC LIMIT 1` after run(). Safe under concurrency=1.
- **`toEngineEvent` duplicated in consumer**: Cannot export from engine without changing the package. Inline conversion is 12 lines and identical to workflow-runner.ts.

## Deferred Issues

- OAuth tokens currently stored with `INSERT` only — re-running setup-gmail creates a duplicate row. `getTokens` uses `LIMIT 1` with no ORDER BY, so stale rows cause `invalid_grant`. Fix: either add a `DELETE WHERE` before insert in setup-gmail, or make storeTokens upsert (requires changing @sprigly/oauth-tokens).
- `markAsRead` silently fails with `gmail.readonly` scope — emails stay unread in Gmail inbox. Acceptable for v0.1; fix by adding `gmail.modify` scope back if desired.
- No BullMQ retry configuration — default (3 attempts, exponential backoff) is fine for v0.1.
- No per-client poll intervals — one global POLL_INTERVAL_MS for all clients.

## Phase 2 Complete

All 5 plans complete. Phase 2 — Engine + First Workflow — is done.

End-to-end loop is live: `Blog: [topic]` email → Gmail poller → BullMQ → WorkflowRunner (3 Claude calls) → DbSaveBlogPost + GmailSendNotification.

## Next Plan

Phase 3: Admin UI — 03-01 (apps/web scaffold + Clerk auth + dashboard + clients list)
