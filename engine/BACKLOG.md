# Backlog

Technical debt and deferred cleanup items. Address when the relevant area is being actively worked.

---

## Sources

### Restore watermark-based Gmail polling

Plan 03-08 designed watermark-based polling: use Gmail's `after:` date operator combined with a `last_polled_at` timestamp per `oauth_connections` row to fetch only messages newer than the last poll. This preserves the client's inbox unread state -- messages are never marked read by Sprigly.

The current implementation (`packages/sources/src/gmail/gmail-client.ts:listMessageIds`) uses `q: 'in:inbox is:unread'` and marks every processed message as read via `markAsRead()`. This mutates the client's inbox and will be confusing or disruptive if the Gmail account is used by a human for non-Sprigly email alongside workflow triggers.

**To do:**
1. Add `last_polled_at` column to `oauth_connections` (nullable timestamp)
2. In `GmailApiClient.listMessageIds()`, accept an optional `after` date and include `after:YYYY/MM/DD` in the query string when provided
3. In `GmailPoller.poll()`, read `last_polled_at` from `oauth_connections` before calling `listMessageIds()`, and update it after each poll cycle
4. Remove `client.markAsRead(messageId)` calls (idempotency is handled by `processed_external_ids`, not by inbox read state)
5. Update `infrastructure/sources.md` when this lands

**Why deferred:** No current clients use a shared human inbox alongside workflow triggers. Restore before onboarding any such client.

---

## Destinations

### Drop `prospect_sheets` table and `DbSaveProspectSheet` destination class

`prospect_sheets` was created in migration `0000` as initial scaffolding before the generic `workflow_outputs` pattern was established. `DbSaveProspectSheet` was built against it in Phase 3 but is unwired — the prospect research workflow now routes through `db-save-output`.

**To do:**
1. Confirm no historical prospect data exists in `prospect_sheets` that needs referencing
2. Drop `DbSaveProspectSheet` class from `packages/destinations/src/prospect/db-save-prospect-sheet.ts`
3. Generate a drizzle migration to `DROP TABLE prospect_sheets`
4. Remove the `prospectSheets` export from `@sprigly/db`
5. Update `DbSaveOutput` comment that mentions `prospect_sheets` as exempt

**Why deferred:** No data in the table; no live references. Safe to drop at any time once confirmed.

---

## Destinations

### Consolidate template substitution utilities

`substituteTemplate` lives in `packages/destinations/src/generic/template.ts`. The workflow scaffold generates a duplicate `fillTemplate` in each new workflow, and the existing `sprigly-blog-post` and `sprigly-prospect-research` workflows also carry local copies. When a third workflow consumer arrives (or when the destinations/workflows boundary is revisited), extract to a shared `@sprigly/utils` package or a top-level `packages/template/` utility.

**Why deferred:** Three isolated copies is not yet painful. Extract when the fourth arrives or when a bug in the logic needs fixing in multiple places.

---

### Extract `composeMimeWithAttachment` into a standalone utility

`composeMimeWithAttachment` is currently defined inline in `packages/destinations/src/generic/gmail-reply-with-attachment.ts`. If a second attachment-sending destination is added, this logic should move to a shared `compose-mime.ts` utility in the same `generic/` folder.

**Why deferred:** Only one destination uses it today. Extract when the second consumer arrives.

---

## Web Search

### Add `web_search_errors` table

Mirror the `gmail_operation_errors` pattern: a `web_search_errors` table with `provider`, `query`, `status_code`, `error_message`, `workflow_run_id`, and a resolution state column. Surface in admin UI.

Currently, Tavily failures (`WebSearchError`) propagate up through the BullMQ job and land in `workflow_runs.error` (visible in the admin UI) and Railway pino logs (structured, queryable). That's sufficient visibility for now but not independently queryable.

**To do:**
1. Create `web_search_errors` migration (mirror `gmail_operation_errors` schema)
2. Add a `WebSearchErrorLogger` that writes to the table, analogous to `GmailOperationErrorLogger`
3. Wire into the worker's BullMQ error handler (catch `WebSearchError` instances specifically)
4. Add admin UI panel alongside the Gmail errors panel

**Why deferred:** Current visibility (Railway logs + `workflow_runs.error`) is sufficient. "Fail loudly with visibility" is already met. The table adds queryability for trends (e.g. recurring provider outages) but is not urgent.
