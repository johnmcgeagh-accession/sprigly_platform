# Sources

## Purpose

`@sprigly/sources` handles everything from the external message arriving to an `incoming_events` row being ready for the BullMQ queue. It fetches messages, parses them, checks idempotency, matches routing rules, persists matched events, and marks messages as processed.

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
| `listMessageIds(maxResults?)` | Fetches unread inbox messages: `q: 'in:inbox is:unread'`. Default 50. |
| `getMessage(messageId)` | Fetches full message with headers and body. |
| `markAsRead(messageId)` | Removes the `UNREAD` label. Errors are caught and logged to `gmail_operation_errors`, not re-thrown. |
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

For each message ID returned by `listMessageIds()`:

1. **Idempotency check first.** Query `processed_external_ids` for `(clientId, 'gmail', messageId)`. If found: call `markAsRead()` and continue to the next message. This is the cheapest path -- avoids fetching the message content at all.
2. **Fetch and parse.** Call `getMessage()` to get full message content. Parse subject, from, to, date, and body text.
3. **Build `IncomingEventDraft`.** Assemble the in-memory draft with `sourceMetadata` containing `messageId`, `threadId`, `from`, `to`, `subject`, `date`.
4. **Match rules (pure, no DB).** Call `matchRules(draft, rules)` using the rules loaded once per poll cycle. No DB query at this step.
5. **No match:** Insert `processed_external_ids` record (Gmail message ID only -- no email content stored). Call `markAsRead()`. Continue.
6. **Match:** Insert `incoming_events` row (full content persisted). Insert `processed_external_ids` record. Call `markAsRead()`. Increment count.

Rules are loaded once per client per poll cycle (before the message loop) via `router.loadRules(clientId, 'email')`. This avoids a DB query per message when polling a high-volume inbox.

### `is:unread` vs watermark

The current implementation fetches `in:inbox is:unread` messages. Every matched message is marked as read after processing. This mutates the client's inbox.

The original design (Plan 03-08) specified watermark-based polling: a `last_polled_at` timestamp stored per `oauth_connections` row, used to build a `after:YYYY/MM/DD` Gmail query. This would avoid marking any messages as read and leave the inbox in its original state. That design was never implemented -- the `oauth_connections` schema has no `last_polled_at` column, no watermark logic exists anywhere in the codebase, and ADR 7 was initially written as "why watermark" before the code was verified. The `is:unread` implementation is the current reality. A BACKLOG item tracks restoring watermark polling. It is architectural debt that must be paid before onboarding any client whose Gmail inbox is shared with a human for non-Sprigly use. See `BACKLOG.md` and `architecture/decisions.md` ADR 7.

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

**`markAsRead` errors are swallowed.** If `markAsRead()` fails (e.g. a transient Google API error), the error is logged to `gmail_operation_errors` and pino, but processing continues. The next poll cycle will attempt to process the same message again (it's still unread in Gmail). The `processed_external_ids` idempotency check will catch it and skip content processing, but `markAsRead` will be attempted again. This is a low-risk loop but will generate repeated `gmail_operation_errors` entries until the Gmail API recovers.

**`is:unread` marks client inbox messages as read.** As described above, this is a known limitation of the current polling implementation. See BACKLOG for the watermark fix.

**Idempotency record is written before `incoming_events`.** The sequence is: check `processed_external_ids`, if not found then persist `incoming_events`, then persist `processed_external_ids`. A crash between the two inserts would leave an event row without an idempotency record, allowing the same message to be processed again on the next poll. This is an edge case -- the event would be double-processed and produce a duplicate workflow run. It has not occurred in production.

**The email parser silently discards unknown field labels.** If the email body contains `Unknown Label: some text` and `unknownLabel` is not in the spec, the label and its continuation lines are consumed into a discard bucket. The previous known field is not corrupted. This prevents malformed emails from attaching junk text to valid fields.

**`content.structured.subject` duplicates `sourceMetadata.subject`.** The `IncomingEventDraft` builder sets `content.structured = { subject }` (line 98 in `gmail-poller.ts`). `subject` is already in `sourceMetadata`. This is because routing conditions on `field: 'subject'` read from `sourceMetadata`, but some workflow parsers read from `content.text` or `content.structured`. The duplication is intentional for routing rule evaluation purposes.

---

## Cross-references

- `architecture/decisions.md` ADR 7 (`is:unread` vs watermark)
- `architecture/decisions.md` ADR 8 (match-all + fallback routing)
- `infrastructure/routing.md` (rule evaluation and the `matchRules` function)
- `reference/database-schema.md` (`incoming_events`, `processed_external_ids`, `gmail_operation_errors`, `oauth_connections`)
- `operations/troubleshooting.md` (Gmail errors, OAuth token issues)
- `BACKLOG.md` (watermark polling restoration)
