# Sources

## Purpose

`@sprigly/sources` handles everything from the external message arriving to an `incoming_events` row being ready for the BullMQ queue. It fetches messages, parses them, checks idempotency, matches routing rules, persists matched events, and marks matched messages as processed.

Currently one source is implemented: Gmail. The `SourceType` enum in `packages/engine/src/types.ts` includes `email`, `sms`, `slack`, `form`, `voice`, `webhook`, and `schedule` -- only `email` is wired in the worker.

The email parser (`packages/sources/src/email-parser/`) is a standalone utility shared across workflows. It parses structured fields from a plain-text email body without knowing which workflow will consume the result.

---

## Interface

### `GmailPoller`

`packages/sources/src/gmail/gmail-poller.ts`.

```typescript
class GmailPoller {
  constructor(
    db: Db,
    encProvider: EncryptionProvider,
    googleClientId: string,
    googleClientSecret: string,
    router: EventRouter,
    logger?: Logger,
  )

  async poll(clientId: string): Promise<number>
}
```

`poll(clientId)` runs one poll cycle for one client. Returns the count of new `incoming_events` rows created (not the total messages seen). Called for every active Gmail connection by `pollAllClients()` in `apps/worker/src/poller.ts`.

### `GmailApiClient`

`packages/sources/src/gmail/gmail-client.ts`. Wraps the Google Gmail API. Constructed per poll cycle inside `GmailPoller.poll()`.

Key methods:

| Method | Notes |
|---|---|
| `listMessageIds(watermark, maxResults?)` | Fetches inbox messages received at or after `watermark`. Query: `in:inbox after:<unix_seconds>`. Falls back to `is:unread` only when watermark is null (should not occur after migrations are applied). |
| `getMessage(messageId)` | Fetches full message with headers and body. |
| `markAsRead(messageId)` | Removes the `UNREAD` label. Only called for messages that matched a routing rule. Errors are caught and logged to `gmail_operation_errors`, not re-thrown. |
| `getProfileEmailAddress()` | Calls `users.getProfile` to retrieve the authorised account's email address. Returns `null` on error rather than throwing. Used during OAuth setup and the backfill script. |
| `createDraft(params)` | Creates a Gmail draft. Errors caught and logged; returns `{ draftId: '', messageId: '' }` on failure. |

Token refresh is handled automatically by the Google OAuth2 client's `tokens` event. When tokens are refreshed, `storeTokens()` is called to persist the new tokens.

### `parseEmailInput(subject, body, spec)`

`packages/sources/src/email-parser/index.ts`. Generic structured parser for emails that follow the "subject prefix + labelled body fields" pattern.

```typescript
function parseEmailInput(
  subject: string,
  body: string,
  spec: EmailInputSpec,
): ParsedEmailInput | null
```

Returns `null` if the subject does not start with `spec.subjectPrefix`. Returns a `ParsedEmailInput` otherwise:

```typescript
interface ParsedEmailInput {
  primaryValue: string;              // text after the subject prefix
  bodyFields: Record<string, string | undefined>;
}
```

`EmailInputSpec` defines the prefix and the expected body fields:

```typescript
interface EmailInputSpec {
  subjectPrefix: string;
  bodyFields: Array<{
    key: string;
    aliases?: string[];
    required?: boolean;
  }>;
}
```

Each workflow's `parse-input.ts` calls this to extract structured input from the raw event. See `workflows/anatomy.md` for usage.

---

## Implementation notes

### Poll cycle sequence in `GmailPoller.poll()`

The poller is **mode-agnostic** — it does not branch on `polling_mode`. Selective vs full behaviour is expressed entirely through which routing rules exist for the client (see "Polling mode and routing rules" below). The cycle is identical for both modes:

1. **Capture `cycleStart = new Date()`** before any API calls. This becomes the new watermark value if the cycle succeeds.
2. **Fetch message IDs.** Query Gmail with `in:inbox after:<lastPolledAt unix seconds>`. This returns all inbox messages received at or after the watermark, regardless of read state.
3. **Load routing rules once** via `router.loadRules(clientId, 'email')`. Avoids a DB query per message.
4. **For each message ID:**
   a. **Idempotency check first.** Query `processed_external_ids` for `(clientId, 'gmail', messageId)`. If found: `continue` immediately. No mark-read. No re-evaluation.
   b. **Fetch and parse.** Call `getMessage()`. Parse subject, from, to, date, body. Build `IncomingEventDraft`.
   c. **Match rules (pure, no DB).** Call `matchRules(draft, rules)`.
   d. **No match:** Insert `processed_external_ids` record only. **Do not call `markAsRead`. Do not persist to `incoming_events`. The email is left completely untouched in the client's inbox.** In full mode this branch is dead code once the match-all fallback rule exists — but if no rules are configured at all, leaving the email untouched is the safe default (not force-persisting an event with no workflow to route to).
   e. **Match:** Wrap in a transaction: insert `incoming_events` row, insert `processed_external_ids` record. Then call `markAsRead`. Increment count.
5. **Advance watermark.** Update `oauth_connections.last_polled_at = cycleStart`. Only reached if the loop completed without throwing. If the cycle throws, `last_polled_at` is not advanced; the next cycle re-fetches the same window and the idempotency table prevents re-processing.

### Watermark and idempotency: how they work together

The watermark determines *which messages to fetch* (only emails since the last cycle). The idempotency table determines *which messages to skip* within that fetch. They serve different purposes:

- Watermark narrows the Gmail query window, reducing API calls over time.
- Idempotency catches boundary cases: emails arriving at the exact watermark timestamp, messages that appear in two consecutive windows due to Gmail's `after:` granularity, and cycles that interrupted before `last_polled_at` advanced.

Never rely on the watermark alone. An email must be skippable via `processed_external_ids` even if it falls inside the current query window.

### Watermark advancement: why cycleStart, not cycle-end

The new watermark is captured *before* the Gmail API call, not after. If the cycle takes 30 seconds and emails arrive during that window, using cycle-end as the watermark would discard them. Using cycle-start means the next cycle's window begins at the start of the current one, so emails that arrive during processing are included in the next fetch. The idempotency table prevents re-processing anything already handled.

### Polling mode and routing rules

`oauth_connections.polling_mode` controls what routing rules exist for the client's mailbox, but **does not change the poller's per-message logic**. The distinction between modes is expressed entirely in the routing layer:

| Mode | What routing rules exist | Effect |
|---|---|---|
| `selective` | Client-specific rules only (subject prefix etc.) | Unmatched emails are untouched; only explicitly matching emails are persisted and marked read |
| `full` | Client-specific rules PLUS an auto-created match-all fallback rule (`conditions: []`, `isFallback: true`) targeting `sprigly-inbox-noop` | Every email matches (specific rules fire first; fallback catches the rest); every email is persisted and marked read |

**Full mode's "mark everything read" property is a consequence of the fallback rule matching everything**, not a poller override. This means a full-mode mailbox that has no fallback rule (e.g. between a mode switch and the rule being created, or if it is manually disabled) behaves identically to selective mode — emails hit the leave-unread safety branch rather than being force-persisted with no workflow to route to.

**Switching modes** must go through `switchPollingMode()` in `packages/sources/src/mailbox-mode.ts`. This atomically:
1. Updates `polling_mode` on the connection row (keyed on connection `id`).
2. Resets `last_polled_at = NOW()` so pre-switch emails are not reprocessed.
3. Ensures/disables the auto-created fallback rule.

Never write `polling_mode` directly — this bypasses the rule sync and watermark reset. The admin UI's mailbox management page (`/admin/mailboxes`) enforces this by routing through `switchPollingMode`.

All connections default to `selective` on creation.

### Email address on connections

`oauth_connections.email_address` stores the Gmail address that was authorised. Populated at connection creation by `setup-gmail-oauth.ts` via `users.getProfile`. Existing connections with a null value can be backfilled by running `pnpm tsx scripts/backfill-connection-emails.ts` (run once in production after deploying this commit).

### Email parser field detection

`parseEmailInput()` detects field declarations using this rule: a line is a field declaration if the part before the first `:` contains only letters and spaces (starting with a letter) and the character after `:` is a space or end of line. This excludes URLs (`https://...`), ratios (`2:1`), and search operators (`site:linkedin.com`).

Multi-line values are supported. Continuation lines after a field declaration are accumulated. Blank lines within a value are preserved as paragraph separators.

### Gmail operation error logging

`GmailApiClient` accepts an `onOperationError` callback. `GmailPoller` provides a callback that inserts a `gmail_operation_errors` row and logs via pino. The callback catches and swallows its own failures -- a DB write error in the error logger must not cascade.

---

## How to extend

### Adding a new source type

1. Create a new poller class (e.g. `packages/sources/src/slack/slack-poller.ts`) that emits `IncomingEventDraft` objects.
2. For each draft: call `router.route(draft)` to get matching rules; if matched, insert to `incoming_events` and your source's idempotency table; enqueue a BullMQ job.
3. Add the new source type to `SourceType` in `packages/engine/src/types.ts` (it is already a union; just add the string literal).
4. Register the poller in `apps/worker/src/index.ts` alongside `GmailPoller`.
5. Add the new source type to `infrastructure/routing.md` and `reference/glossary.md`.

The `EventRouter.loadRules()` call takes a `SourceType` argument -- a routing rule for the new source type will be loaded automatically once the string matches.

### Handling a new email field type

Add new `bodyFields` entries to the `spec` passed to `parseEmailInput()` in the workflow's `parse-input.ts`. The parser supports aliases -- e.g. `{ key: 'meetingDate', aliases: ['meeting date', 'date'] }` matches any of those labels case-insensitively.

---

## Gotchas

**`markAsRead` errors are swallowed, but only matched emails are ever marked read.** `markAsRead` is called only for emails that matched a routing rule (in selective mode) or matched the fallback rule (in full mode). If it fails, the error is logged to `gmail_operation_errors` and processing continues. The email will not be re-processed (the idempotency record was already written), but it will remain unread in Gmail. Repeated `markAsRead` failures for the same message will not occur because the idempotency skip path does not call `markAsRead`.

**Unmatched emails are never force-processed.** An email that matches no routing rule (including no fallback rule) is written to `processed_external_ids` and left entirely alone. The `UNREAD` label is not removed. The message is not persisted. In selective mode this is the normal path for non-Sprigly emails. In full mode with a correctly configured fallback rule, this path should never be reached.

**Idempotency record is written before `incoming_events` on the no-match path, but after on the match path.** On the no-match path: `processedExternalIds` is inserted immediately (no `incomingEvents` row exists). On the match path: `incomingEvents` is inserted first, then `processedExternalIds`. A crash between those two on the match path leaves an event row without an idempotency record, allowing the message to be processed again on the next cycle. This is an edge case -- the event would be double-processed and produce a duplicate workflow run. It has not occurred in production.

**Watermark `after:` uses Unix seconds, not a date string.** `listMessageIds` passes `Math.floor(watermark.getTime() / 1000)` to Gmail's `q` parameter. Gmail's `after:` operator accepts Unix epoch seconds. If this ever produces unexpected results, verify the watermark value stored in `oauth_connections.last_polled_at` is in UTC and the conversion is correct.

**The email parser silently discards unknown field labels.** If the email body contains `Unknown Label: some text` and `unknownLabel` is not in the spec, the label and its continuation lines are consumed into a discard bucket. The previous known field is not corrupted.

**`content.structured.subject` duplicates `sourceMetadata.subject`.** The `IncomingEventDraft` builder sets `content.structured = { subject }`. `subject` is already in `sourceMetadata`. Routing conditions on `field: 'subject'` read from `sourceMetadata`, but some workflow parsers read from `content.text` or `content.structured`. The duplication is intentional.

---

## Cross-references

- `architecture/decisions.md` ADR 7 (watermark polling: motivation and design)
- `architecture/decisions.md` ADR 8 (match-all + fallback routing)
- `architecture/decisions.md` ADR 10 (no-op default workflow for full mode)
- `architecture/decisions.md` ADR 11 (polling mode lives in routing rules, not the poller)
- `infrastructure/routing.md` (rule evaluation, `matchRules`, auto-created fallback rule, `switchPollingMode`)
- `reference/database-schema.md` (`incoming_events`, `processed_external_ids`, `gmail_operation_errors`, `oauth_connections`)
- `operations/troubleshooting.md` (Gmail errors, OAuth token issues)
