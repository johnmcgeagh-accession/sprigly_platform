# Notification emails send from the operator identity

**Date:** 2026-07-21
**Branch:** `dev`
**Commit:** `c54b044` — *feat: notification emails send from the operator identity*

Implements the decision banked in the July app-surface session: platform→client
notifications should not depend on per-client Gmail OAuth. Proven on UAT the day before —
earl-of-east, `err="No Gmail tokens for client"`, client heard nothing.

---

# PART 0 — investigation

## 0a. Does an OAuth connect flow exist?

**Yes — a complete one. It was never seeded by hand.**

| piece | file |
|---|---|
| authorize | `admin/src/app/api/oauth/[provider]/authorize/route.ts` |
| callback | `admin/src/app/api/oauth/[provider]/callback/route.ts` |
| state signing / URL building | `admin/src/lib/google-oauth.ts` |

```ts
// authorize/route.ts:16-21
const clientId = new URL(req.url).searchParams.get('clientId');
if (!clientId) return NextResponse.json({ error: 'missing_clientId' }, { status: 400 });
const state = signState({ clientId, provider, nonce: newNonce() });
return NextResponse.redirect(buildAuthUrl(provider, redirectUri(req, provider), state));
```

**But there is exactly one entry point into it, and it can only ever RE-connect.**
`admin/src/app/admin/mailboxes/page.tsx:129` links to
`/api/oauth/${m.provider}/authorize?clientId=${m.clientId}` — and that page's list is:

```ts
.from(oauthConnections)
.innerJoin(clients, eq(oauthConnections.clientId, clients.id))
```

An **inner join from `oauth_connections`**. A client with no row cannot appear, so it cannot
be offered a connect link. The client detail page reads connections for display
(`clients/[id]/page.tsx:240-251`, `getOAuthConnections`) but offers **no connect
affordance at all**.

So: ivy-t and sprigly have rows because they were connected through this flow when they were
already listed. earl-of-east, having zero rows, is invisible to the only surface that links
to the flow. The machinery exists; the door to it opens only from the inside.

**Workaround available now** (no code needed): hit the authorize URL directly with the
client id —
`https://<admin-host>/api/oauth/gmail/authorize?clientId=d5ea71c4-8859-4be2-9335-3b4b484ec312`.

**BACKLOGGED (out of scope, per the brief):** a connect/reconnect affordance on the client
page, and/or a mailboxes list that left-joins from `clients` so unconnected clients appear
with a "Connect" button rather than not at all.

## 0b. Every `getTokens` / `oauth_connections` consumer, classified

**Notification-class — platform writing TO a client (moved to the operator identity):**

| file:line | what |
|---|---|
| `packages/destinations/src/generic/gmail-reply-with-attachment.ts:205,234` | the send seam, **as reached from `deliverTemplatedEmail`** |
| ← via `engine/src/content-cycles/email-send.ts:112` | `ask`, `ask_drafted`, `nudge`, `last_call` (caller `consumer.ts:212`) |
| ← via `engine/src/content-cycles/email-send.ts:112` | `plan_ready`, `plan_ready_auto` (caller `planning.ts:712`) |

`deliverTemplatedEmail` has exactly **two** callers and its input type is
`key: EmailTemplateKey`, whose union is exactly those six. **Every template it serves is
notification-class**, which is why the routing rule needs no per-template branching.

**Client-identity — reading or acting AS the client (unchanged):**

| file:line | provider | why it must stay the client |
|---|---|---|
| `engine/src/content-cycles/request-email.ts:201` (via `gmail-draft-service.ts:30`) | gmail | **creates a draft, never sends** — it has to land in the client's own Drafts for a human to approve |
| `packages/sources/src/gmail/gmail-poller.ts:66` | gmail | monitors the client's inbox |
| `packages/sources/src/gmail/gmail-read-state.ts:34` | gmail | read/unread state in their mailbox |
| `packages/sources/src/gmail/gmail-draft-service.ts:30` | gmail | drafts into their mailbox |
| `engine/src/check-sent-drafts.ts:54` | gmail | reads what the client actually sent |
| `engine/src/backfill-connection-emails.ts:47` | gmail | backfills the client's own connection address |
| `engine/src/digest-sender.ts:121` | gmail | triage digest — a different product surface, not in the notification set |
| `packages/destinations/src/notification/gmail-send-notification.ts:45` | gmail | generic destination; not reached by `deliverTemplatedEmail` |
| **all 19 `drive` call sites** — `planning.ts:537`, `extract.ts:198`, `apply.ts:170`, `drive-poller.ts:161`, `voice-consumer.ts:320`, `calendar-consumer.ts:131`, `stubs.ts:42`, `admin/src/lib/ingest/drive.ts:17`, `sprigly-calendar-build-workbook.ts:130`, plus CLIs/probes | drive | the client's own folder — out of scope entirely |

### One correction to the brief

The brief listed **request-email** as notification-class. It isn't, in the code as written:
`request-email.ts:5-6` says *"this worker creates a draft only. No send call exists in this
file or its dependencies"*, and `:201` calls `gmailDraftService.createDraft(clientId, …)`.
A draft that must appear in the **client's** Drafts for a human to approve is
client-identity, so it keeps client tokens — and there is a test asserting exactly that.

If the intent was that request-email should eventually *send* as the operator, that is a
different change (draft → send) and not this one.

---

# The build

## The resolution rule

> **`deliverTemplatedEmail` sends as the operator. Everything else keeps client tokens.**

No per-template branching, because Part 0b establishes that every template that function
serves is notification-class. The rule is the function boundary.

## Storage — and why

`OPERATOR_SEND_CLIENT_ID` (env) holds a **client id pointing at an existing
`oauth_connections` row**. Rejected alternatives:

| option | why not |
|---|---|
| duplicate the tokens into an operator-owned row | two rows refreshing independently against one Google account; the copy expires silently and nothing reconnects it |
| a flagged column (`is_operator`) | needs a migration, and makes "which is the operator" a data question that can be ambiguous (two flagged) or absent (none) |
| a new operator table | most machinery, least benefit — the row already exists |

Env is right because **which identity is the operator is deployment configuration** — uat
and prod differ — not data about a client. And the referenced row keeps being maintained by
the connect flow that already exists.

Both existing Gmail rows are the same mailbox, `john@sprigly.co.uk`; the **`sprigly`
client's row is the operator identity in substance** and is what UAT should point at.

## What actually changed

`engine/src/content-cycles/email-send.ts` — one substitution:

```ts
const operatorId     = operatorSendClientId();
const sendAsClientId = operatorId ?? clientId;
…
const event = { clientId: sendAsClientId, reply: { data: {} } } as unknown as IncomingEvent;
```

**Only the token lookup moves**, and I verified the blast radius before making it:

- the destination reads *and refreshes* by `event.clientId`
  (`gmail-reply-with-attachment.ts:205, :234`) — so read and write-back stay on the same
  row and cannot drift;
- the recipient is resolved from `settings` before any client-scoped logic runs
  (`:128-130`, `mode: 'address'` returns immediately), so **the pin is untouched**;
- the verified-domain gate (`:138-155`) is on the `verified-domain-gate` branch only and is
  never reached from this path;
- `ctx` is unused by the destination (`_ctx`).

**Unset → falls back to the client's own tokens, with a warning naming the variable.** A
deploy that has not been configured must not change how anything sends; it must say so.

**Failure honesty is preserved.** Missing or invalid *operator* tokens return `false` exactly
as missing client tokens did → `sendAppReadyNotification` returns false → settlement releases
its claim and logs `send_failed` → the daily sweep retries. Never silent.

---

## Test output

`engine/src/content-cycles/email-send.test.ts` — **11 passed** (5 pre-existing + 6 new):

```
✓ THE earl-of-east CASE: sends via the operator, for a client with no oauth row
✓ the delivery PIN is unchanged — only the sender moved
✓ every notification template routes the same way — none of them acts AS the client
✓ UNCONFIGURED falls back to the client and SAYS SO — a deploy changes nothing silently
✓ an empty or blank value is not a configuration
✓ MISSING OPERATOR TOKENS fail exactly like missing client tokens — false, never silent
```

`engine/src/content-cycles/request-email.test.ts` — **19 passed**, including:

```
✓ drafts as the client even when OPERATOR_SEND_CLIENT_ID is set
```

| package | result |
|---|---|
| `@sprigly/worker` | **426 passed** |
| `@sprigly/app` | **426 passed** |
| `@sprigly/engine` | **230 passed** |
| `@sprigly/web` (admin) | **9 passed** |
| `@sprigly/db` | **7 passed** |

Type-check clean across all five.

---

## ⚠️ What must be configured on UAT

**1. Set the operator identity** on the worker service (Railway, `uat` environment):

```
OPERATOR_SEND_CLIENT_ID=199678dd-d7d3-4e3b-91b8-8dd8150742d9
```

That is the `sprigly` client's id, whose `gmail` connection (`john@sprigly.co.uk`, status
`active`, scopes include `gmail.send`) becomes the sending identity. **Until this is set,
behaviour is unchanged** — notifications still try the client's own tokens, and the log will
say `no operator send identity configured` on every send.

**2. Then release the stale stamp** so the sweep can deliver earl-of-east's October email:

```sql
UPDATE content_cycles SET plan_ready_sent_at = NULL, updated_at = now()
 WHERE id = '040d6a1a-9ad4-4d32-bda2-d67b01f70512';
```

**Order matters.** With this change, step 2 no longer depends on earl-of-east having its own
Gmail connection — that was the point. But it does depend on step 1, so set the env var
first, or the sweep will fail the send again and correctly release the claim again.

The cycle is settled (0 generating, no pending jobs), so the next daily tick after both
steps will deliver.

**Not required:** earl-of-east's own Gmail connection. It is still worth having for the
client-identity paths (request-email drafts, inbox monitoring), but notifications no longer
wait on it — which is the whole change.

---

## Out of scope, recorded

- **Admin connect/reconnect UI** — see Part 0a. The flow works; the only link into it comes
  from a list that inner-joins `oauth_connections`, so a client with no row can never be
  offered it. Direct-URL workaround given above.
- **Per-client inbox monitoring** and **all Drive paths** — untouched, and correctly so:
  both genuinely act as the client.
- **`digest-sender.ts`** — a triage-digest surface outside the notification set. It uses
  client tokens today. Whether it should also move to the operator identity is a real
  question, but it is a different product surface and I did not change it.
- **`GmailSendNotification`** (`packages/destinations/src/notification/`) — a generic
  destination not reached by `deliverTemplatedEmail`. If a workflow ever uses it to notify a
  client rather than act as one, it would want the same treatment.
