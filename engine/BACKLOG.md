# Backlog

Technical debt and deferred cleanup items. Address when the relevant area is being actively worked.

---

## Sources

### Optimise selective polling: metadata-only fetch for the match check

In selective mode, `GmailPoller.poll()` calls `client.getMessage(messageId)` (full message: headers + body) for every email in the watermark window before evaluating routing rules. On a busy or shared inbox this means N full Gmail API fetches per cycle, most of which are discarded after the match check fails.

Gmail's `messages.list` returns the message ID only. Routing conditions today only inspect `subject` and `from` headers — fields available in a `messages.get` with `format: 'metadata'`. Body is only needed for matched messages (to build the `IncomingEventDraft.content.text` field consumed by workflow parsers).

**To do:**
1. Add `getMessageMetadata(messageId)` to `GmailApiClient` — calls `messages.get` with `format: 'metadata'` and `metadataHeaders: ['Subject', 'From', 'To', 'Date']`
2. In the selective poll loop, call `getMessageMetadata` first; build a lightweight draft with headers only; run `matchRules`
3. Only call `getMessage` (full body) for messages that matched; patch `draft.content.text` before persisting
4. Update `docs/infrastructure/sources.md` when this lands

**Why deferred:** All current client inboxes are low-volume dedicated addresses; the extra fetches are not a cost or latency problem. Optimise before onboarding a high-volume or shared inbox.

---

### Full polling mode + management UI (commit 2 of 2)

Watermark-based selective polling landed in `0010_selective_polling.sql`. The `polling_mode` column exists with values `'selective'` (implemented) and `'full'` (placeholder — `GmailPoller.poll()` logs a warning and returns 0).

`full` mode is the path where Sprigly marks every inbox email as read and processes all of them regardless of routing rules. It is intended for clients who use the Gmail account exclusively for Sprigly triggers.

**To do:**
1. Implement the `full` mode branch in `GmailPoller.poll()` (remove the early-return placeholder)
2. Add a match-all rule that routes to a no-op default workflow, or route all messages to the existing workflow directly
3. Add a no-op default workflow that discards matched events without running steps
4. Add mode-switch logic in the worker (allow toggling between `selective` and `full` without a redeploy)
5. Add a management UI page (client settings) where `polling_mode` can be toggled per connection
6. Update `docs/infrastructure/sources.md` and add ADR when this lands

**Why deferred:** No current clients need full mode. Selective mode is the correct default for any client using their Gmail account for non-Sprigly email alongside workflow triggers.

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
