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

### Re-target full-mode fallback rule to the triage agent (inbox-agent phase)

Full mode currently routes unmatched emails to `sprigly-inbox-noop` (the no-op confirmation workflow). This is a scaffold — the intended target is an inbox triage agent that intelligently routes and prioritises emails.

**To do:**
1. Build the triage agent workflow.
2. Update `NOOP_WORKFLOW_ID` in `packages/sources/src/mailbox-mode.ts` to the triage agent's workflow ID.
3. Migrate existing auto-created rules: `UPDATE routing_rules SET workflow_id = '<triage-agent-id>' WHERE auto_created = true`.
4. Update `docs/workflows/existing.md` to describe the triage agent and retire the noop entry.

**Why deferred:** No triage logic exists yet. The noop workflow proves the full-mode plumbing end-to-end with zero risk of autonomous action.

---

### Admin server actions have no test coverage

All `actions.ts` files in `apps/web/src/app/admin/` (routing-rules, approvals, gmail-errors, clients, mailboxes) are untested. These are thin callers over `@sprigly/db` and `@sprigly/sources` functions that are themselves unit-tested, so the risk is low — but a broken action would not be caught before deploy.

**To do:**
- Decide on a test strategy for Next.js server actions (Jest + MSW, Playwright E2E, or mocking `@sprigly/db`).
- At minimum, test `changeMailboxMode` in `apps/web/src/app/admin/mailboxes/[id]/actions.ts` — the highest-stakes action since it calls the atomic `switchPollingMode` operation.

**Why deferred:** No test framework is currently set up for Next.js server actions in this repo. The `switchPollingMode` unit tests in `packages/sources/src/mailbox-mode.test.ts` cover the logic; the UI is a thin caller.

---

### `switchPollingMode` and multi-mailbox-per-client routing

`switchPollingMode` manages the auto-created fallback rule at `clientId` scope — one fallback rule per client. This works correctly today because each client has at most one Gmail mailbox.

If a client ever has multiple mailboxes (e.g. two Gmail connections), switching one mailbox to selective would disable the fallback rule for both, breaking full mode on the other. The routing rules need to be re-scoped to per-connection rather than per-client before multi-mailbox is supported.

**To do:**
1. Add a `connectionId` foreign key on `routing_rules` (nullable — existing manual rules are not connection-scoped).
2. Update `switchPollingMode` to scope the rule lookup and disable/enable to `connectionId` rather than `clientId`.
3. Update the Mailboxes admin UI to reflect per-connection rule state.
4. Migrate any existing auto-created rules to carry the `connectionId` of the connection that created them.

**Why deferred:** All current clients have exactly one Gmail mailbox. Address before onboarding any client who needs multiple mailboxes.

---

### ~~Dockerfile should run migrations on container start~~ ✓ Done

`docker-entrypoint.sh` runs `pnpm --filter @sprigly/db migrate:prod` (no `--env-file`; reads `DATABASE_URL` from Railway env) then `exec`s into the worker. Dockerfile `CMD` now points to the entrypoint. `@sprigly/db` gained a `migrate:prod` script alongside the dev `migrate` script.

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


- [ ] Fix drizzle migration drift: journal stops at 0026, migrations 0027–0074
      hand-applied via psql (schema.ts is source of truth). migrate() no-ops on
      27+ and generate would recreate them. Fix = squash to one fresh baseline
      from schema.ts + mark already-applied in __drizzle_migrations. Isolated
      task, clean tree, read-only state check first (version-specific).
