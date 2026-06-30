# Routing

## Purpose

`packages/engine/src/event-router.ts` determines which workflows run for an incoming event. It loads active routing rules for a client and source from the database, then evaluates each rule's match conditions against the event's content and metadata. The output is a list of matched `RoutingRule` objects that the consumer uses to drive workflow execution.

The evaluation logic is a pure function (`matchRules()`) that can be tested without a database. The database interaction (`loadRules()`) is isolated in `EventRouter`.

---

## Interface

### `EventRouter`

`packages/engine/src/event-router.ts`.

```typescript
class EventRouter {
  constructor(db: Db)

  async loadRules(clientId: string, source: SourceType): Promise<RoutingRule[]>
  async route(draft: IncomingEventDraft): Promise<RoutingRule[]>
}
```

`loadRules()` fetches all enabled routing rules for a `(clientId, source)` pair, ordered by `priority` descending. Used by `GmailPoller.poll()` once per poll cycle (before the message loop) to avoid per-message DB queries.

`route()` is a convenience wrapper: calls `loadRules()` then `matchRules()`. Used by the BullMQ consumer when processing an already-persisted event.

### `matchRules(draft, rules)`

Pure function. No DB, no side effects. Exported from `packages/engine/src/event-router.ts`.

```typescript
function matchRules(draft: IncomingEventDraft, rules: RoutingRule[]): RoutingRule[]
```

1. Evaluate all rules. A rule matches if every condition in its `match.conditions` array passes.
2. Separate matched rules into primary (non-fallback) and fallback.
3. If any primary rules matched: return primary rules only.
4. Otherwise: return matched fallback rules.

### `evaluateCondition(condition, draft)`

Evaluates a single `MatchCondition` against a draft. Exported -- useful for unit tests.

```typescript
function evaluateCondition(condition: MatchCondition, draft: IncomingEventDraft): boolean
```

**Field resolution:**

| `condition.field` | Resolves to |
|---|---|
| `'body'` | `draft.content.text` |
| Any other string | `String(draft.sourceMetadata[field] ?? '')` |

For Gmail events, the available `sourceMetadata` fields are: `messageId`, `threadId`, `from`, `to`, `subject`, `date`.

**Operator evaluation:**

| `op` | Logic |
|---|---|
| `'regex'` | `new RegExp(value, caseSensitive ? '' : 'i').test(raw)` |
| `'equals'` | Exact string match (case-insensitive by default) |
| `'contains'` | `val.includes(target)` |
| `'startsWith'` | `val.startsWith(target)` |
| `'endsWith'` | `val.endsWith(target)` |

When `caseSensitive` is `false` (the default), both `raw` and `target` are lowercased before comparison. The `regex` op uses the `'i'` flag for case-insensitive matching.

---

## Implementation notes

### Priority and ordering

`loadRules()` orders by `priority DESC`. Higher priority numbers are evaluated first. A rule with `priority: 10` is returned before a rule with `priority: 0`. Within the same priority, database insertion order determines sequence (no secondary sort is applied).

Priority affects the order rules are returned from `loadRules()`, but `matchRules()` evaluates ALL loaded rules and collects all matches before applying the primary/fallback split. Priority does not cause early-exit on first match.

### AND logic within a rule

All conditions in a rule's `match.conditions` array must pass:

```typescript
function evaluateConditions(conditions: MatchCondition[], draft: IncomingEventDraft): boolean {
  return conditions.every((c) => evaluateCondition(c, draft));
}
```

There is no OR logic within a single rule. To express OR (e.g. "subject starts with 'Blog:' OR 'Post:'"), create two separate routing rules pointing at the same workflow.

### Fallback logic

A rule with `isFallback = true` fires only when no non-fallback (primary) rule matched. The fallback flag is checked after all rules are evaluated:

```typescript
const matched = rules.filter((rule) => evaluateConditions(rule.match.conditions, draft));
const primary = matched.filter((r) => !r.isFallback);
if (primary.length > 0) return primary;
return matched.filter((r) => r.isFallback);
```

A fallback rule's conditions are still evaluated -- the fallback flag only controls whether the rule is returned when a primary rule has already matched. A fallback rule with an empty conditions array plus a primary rule with specific conditions gives you: "run workflow A for matching emails, run workflow B for everything else."

### Match-all rules

An empty `match.conditions` array (`[]`) causes `evaluateConditions()` to return `true` via `Array.every()` (vacuously true). This is how match-all rules work. There is no special-case code.

### Auto-created fallback rule and polling mode

When a mailbox is switched to full mode via `switchPollingMode()` (`packages/sources/src/mailbox-mode.ts`), a match-all fallback rule is automatically created (or re-enabled) for that client:

```
conditions:  []           (vacuously matches every email)
isFallback:  true
workflowId:  sprigly-inbox-noop
autoCreated: true
enabled:     true
```

The `autoCreated: boolean` column on `routing_rules` (default `false`) is the distinguishing marker. `switchPollingMode` **only ever touches rules where `autoCreated = true`**. Manually authored rules (`autoCreated = false`) are never modified, disabled, or deleted by mode switching — even if they are also match-all fallback rules.

When a mailbox switches back to selective mode, the auto-created rule is **disabled** (not deleted). This preserves history and makes re-enabling on the next full-mode switch a clean `UPDATE enabled = true` rather than a new `INSERT`.

The `sprigly-inbox-noop` workflow (the current target) records that an email was seen and takes no further action. The inbox-agent phase will re-target the auto-created rule to the triage agent by updating `workflowId` — no other code change needed.

**Full mode's mark-everything-read property is a consequence of this rule existing**, not a poller branch. The poller does not read `polling_mode`. If the auto-created rule is missing or disabled, full mode behaves identically to selective mode (leave-unread safety branch fires for every email).

### Multiple matched rules

`matchRules()` can return more than one rule. The consumer calls `runner.run(rule, eventId)` and `dispatcher.dispatch(output, ...)` once per matched rule. An email that matches two enabled routing rules will trigger two workflow runs.

This can be intentional (e.g. one rule routes to a blog post workflow, another routes to an analytics workflow for the same subject prefix) or accidental (overlapping conditions). Visibility: the `incoming_events` detail page in the admin UI shows all `workflow_runs` for an event.

---

## How to extend

### Adding a new condition operator

1. Add the new op string to the `op` union in `MatchCondition` in `packages/engine/src/types.ts`.
2. Add a case in `evaluateCondition()` in `event-router.ts`.
3. Update the admin UI routing rule editor to offer the new operator.
4. Update the condition table in this document.

Because `evaluateCondition()` is a pure function with unit tests in `packages/engine/src/event-router.test.ts`, adding an operator can be tested without a running database.

### Adding a new matchable field

No code change needed. Any key present in `event.sourceMetadata` is matchable using `field: 'key'`. For a new source type that adds new metadata fields (e.g. a Slack source with a `channelId` field), those fields are automatically available to conditions.

---

## Gotchas

**Priority is descending.** Higher numbers = loaded first. Instinct says "priority 1 is highest" but in this codebase priority 10 beats priority 1. When creating rules via the admin UI, set higher numbers for more specific rules.

**Fallback rules can match even if they seem impossible.** A fallback rule with an empty conditions array matches every event -- but only fires when no primary rule matched. Combine with a specific primary rule and you get a catch-all for unmatched events. The catch-all behaviour is expected and by design, but can be surprising if you forget the rule exists.

**No OR logic within a rule.** If you need OR conditions, use multiple rules. The most common mistake is adding two conditions to one rule when the intent is OR -- both conditions must pass, so the rule is more restrictive than intended.

**Disabled rules are not loaded.** `loadRules()` filters `enabled = true`. If a rule appears to have no effect, check it is enabled in the admin UI.

**The `EventRouter` in the consumer re-routes an already-polled event.** The `GmailPoller` uses `loadRules()` directly to evaluate rules before persisting the event. The `consumer.ts` then calls `router.route(event)` again on the persisted event. In theory a rule could be disabled between poll and process, causing `router.route()` to return no matches. The consumer handles this: `status` is set to `'ignored'` and a warning is logged. It is rare in practice.

---

## Cross-references

- `architecture/decisions.md` ADR 8 (match-all + fallback design)
- `architecture/decisions.md` ADR 10 (no-op default workflow for full mode)
- `architecture/decisions.md` ADR 11 (polling mode lives in routing rules, not the poller)
- `reference/database-schema.md` (`routing_rules` table and JSONB shapes)
- `reference/glossary.md` (routing rule, match condition, fallback rule, match-all rule, priority)
- `infrastructure/sources.md` (how `GmailPoller` uses `loadRules()` before the message loop; polling mode and routing rules)
- `operations/monitoring.md` (admin UI routing rules page, mailboxes page)
