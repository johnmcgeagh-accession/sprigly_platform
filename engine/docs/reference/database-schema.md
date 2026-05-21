# Database Schema

Generated from `packages/db/src/schema.ts`. Every table, every column, every JSONB shape.

All tables share base columns: `id` (UUID, PK, auto-generated), `created_at` (timestamp, not null, default now), `updated_at` (timestamp, not null, default now). Exceptions are noted per table.

---

## `clients`

The top-level multi-tenant boundary. Every row in every other table references a client.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `name` | text | no | | Human-readable name, e.g. "Acme Ltd" |
| `slug` | text | no | | URL-safe identifier, unique. Used in admin UI navigation. |
| `status` | text | no | `'active'` | `ClientStatus`: `active`, `paused`, `archived` |
| `settings` | jsonb | no | `{}` | Freeform per-client settings. Currently unused at engine level. |

---

## `users`

Admin and client users. Authentication is handled by Clerk -- this table stores the role mapping only.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `email` | text | no | | Unique. Must match the Clerk-authenticated email. |
| `role` | text | no | | `UserRole`: `admin`, `client_admin`, `client_user` |
| `client_id` | uuid | yes | | FK to `clients.id`. NULL for platform admins. |

---

## `client_configs`

Per-client content settings injected into `WorkflowContext` when a routing rule has a `client_config_id` set. One config per client in practice, though the schema allows multiple.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `brand_voice` | text | yes | | Free text. Injected into blog post system prompt as `ctx.clientConfig.brandVoice`. |
| `signature` | text | yes | | Email signature. Currently unused by deployed workflows. |
| `author_name` | text | yes | | Author name for blog posts. Injected via `ctx.clientConfig.authorName`. |
| `settings` | jsonb | no | `{}` | Freeform. `sprigly-blog-post` reads `settings['model']` to override the logical model name per client. |

**`settings` JSONB shape used by `sprigly-blog-post`:**
```typescript
{
  model?: 'haiku' | 'sonnet' | 'opus';  // overrides workflow default if set
}
```

---

## `oauth_connections`

Stores encrypted OAuth tokens per client per provider.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `provider` | text | no | | `OAuthProvider`: `gmail`, `outlook`, `slack`. Only `gmail` is implemented. |
| `encrypted_tokens` | text | no | | AES-256-GCM ciphertext (base64). Contains the serialized `OAuthTokenBundle`. |
| `encrypted_data_key` | text | no | | KMS-encrypted data key (base64). Decrypted by KMS to get the key that decrypts `encrypted_tokens`. |
| `scopes` | text[] | no | `'{}'` | Array of OAuth scope strings granted. |
| `email_address` | text | yes | | Gmail address associated with this connection. |
| `status` | text | no | `'active'` | `OAuthStatus`: `active`, `revoked`, `error` |

**Decrypted `encrypted_tokens` shape (`OAuthTokenBundle`):**
```typescript
{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;   // Unix timestamp ms
  scopes: string[];
  emailAddress?: string;
}
```

See `packages/oauth-tokens/src/types.ts` and `packages/oauth-tokens/src/store-tokens.ts` for the encrypt/decrypt flow.

---

## `routing_rules`

Determines which workflow to run for incoming events matching given conditions.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `enabled` | boolean | no | `true` | Disabled rules are never loaded by `EventRouter.loadRules()`. |
| `source` | text | no | | `SourceType`: `email`, `sms`, `slack`, `form`, `voice`, `webhook`, `schedule`. Only `email` is wired in the worker. |
| `match_conditions` | jsonb | no | `[]` | Array of `MatchCondition`. Empty array = match all. |
| `workflow_id` | text | no | | Must match a registered workflow ID (e.g. `sprigly-prospect-research`). |
| `destinations` | jsonb | no | `[]` | Array of `DestinationConfig`. Empty = use workflow's `defaultDestinations`. |
| `client_config_id` | uuid | yes | | FK to `client_configs.id`. Loaded into `WorkflowContext.clientConfig`. |
| `priority` | integer | no | `0` | Rules ordered by priority DESC when loaded. Higher number = evaluated first. |
| `is_fallback` | boolean | no | `false` | When true, only fires if no non-fallback rule matched. |
| `auto_created` | boolean | no | `false` | Set to `true` on rules managed by `switchPollingMode()`. `switchPollingMode` only ever touches `auto_created = true` rows — manually-authored rules are never modified. |

**`match_conditions` JSONB element shape (`MatchCondition`):**
```typescript
{
  field: 'body' | 'subject' | 'from' | 'to' | 'date' | string;
  op: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'regex';
  value: string;
  caseSensitive?: boolean;  // default false
}
```
`field: 'body'` maps to `event.content.text`. All other fields map to `event.sourceMetadata[field]`.

**`destinations` JSONB element shape (`DestinationConfig`):**
```typescript
{
  destinationId: string;       // e.g. 'gmail-reply-with-attachment'
  requireApproval?: boolean;
  settings: Record<string, unknown>;
}
```
See `infrastructure/destinations.md` for per-destination `settings` shapes.

---

## `prompt_templates`

Versioned prompt text per workflow step. Supports both global defaults (`client_id = NULL`) and per-client overrides.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | yes | | NULL = global default. Per-client overrides reference the specific client. |
| `workflow_id` | text | no | | e.g. `sprigly-blog-post` |
| `step_name` | text | no | | e.g. `research`, `write` |
| `prompt_text` | text | no | | The full prompt body. May contain `{{variable}}` substitutions. |
| `version` | integer | no | `1` | Monotonically increasing. `DbPromptResolver` reads the highest version. |
| `copied_from_template_id` | uuid | yes | | Set when a client override was created by copying a global template. Allows detecting drift. |
| `copied_from_version` | integer | yes | | Version of the source template at copy time. |

**Unique index:** `(client_id, workflow_id, step_name, version)`.

Resolution order in `packages/prompts/src/index.ts:DbPromptResolver.resolve()`:
1. Latest version for `(client_id, workflow_id, step_name)`.
2. Latest version for `(NULL, workflow_id, step_name)`.
3. Throws `Error` if neither exists.

---

## `incoming_events`

A persisted record of an inbound message that matched at least one routing rule. Messages that match no rules are tracked only in `processed_external_ids`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `source` | text | no | | `SourceType`. Currently always `email`. |
| `source_metadata` | jsonb | no | `{}` | Provider-specific fields. For Gmail, see shape below. |
| `content` | jsonb | no | | Message content. See shape below. |
| `received_at` | timestamp | no | | Timestamp parsed from the email's `Date` header. |
| `status` | text | no | `'received'` | `EventStatus`: `received`, `routing`, `running`, `completed`, `failed`, `ignored` |
| `external_id` | text | yes | | Gmail message ID. Cross-referenced with `processed_external_ids` for idempotency. |

**`source_metadata` JSONB shape for Gmail source:**
```typescript
{
  messageId: string;
  threadId: string;
  from: string;    // e.g. "John Smith <john@example.com>"
  to: string;
  subject: string;
  date: string;    // raw Date header value
}
```

**`content` JSONB shape:**
```typescript
{
  text: string;                         // plain text body of the email
  structured?: {
    subject: string;                    // duplicated from source_metadata for routing convenience
  };
}
```

---

## `workflow_runs`

One row per workflow execution. Created by `WorkflowRunner.run()` before the workflow starts.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `event_id` | uuid | no | | FK to `incoming_events.id` |
| `client_id` | uuid | no | | FK to `clients.id` |
| `workflow_id` | text | no | | e.g. `sprigly-prospect-research` |
| `status` | text | no | | `WorkflowRunStatus`: `running`, `completed`, `failed` |
| `started_at` | timestamp | no | | Set at row creation. |
| `ended_at` | timestamp | yes | | Set on completion or failure. |
| `output` | jsonb | yes | | Serialized workflow output. Buffers stripped by `stripBuffers()` before storage. |
| `error` | text | yes | | Error string on failure. |
| `outcome` | text | no | `'handled'` | `WorkflowOutcome`: `handled`, `needs_human`, `deferred`. Written by `WorkflowRunner` from `output.outcome`. Absent outcome on legacy workflows defaults to `handled`. |

---

## `audit_log`

One row per model call. Written by `AuditLogger.logModelCall()` in `packages/audit/src/audit-logger.ts`.

Prompts and model output are **not** stored here. Metadata only.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `event_id` | uuid | yes | | FK to `incoming_events.id`. May be NULL for dry-run calls. |
| `workflow_run_id` | uuid | yes | | FK to `workflow_runs.id`. May be NULL for dry-run calls. |
| `action` | text | no | | Step identifier, e.g. `prospect-research`, `blog-write`. Set by the workflow. |
| `model_id` | text | yes | | Full physical model ID, e.g. `eu.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| `input_tokens` | integer | yes | | Total input tokens for the call (may span multiple tool turns). |
| `output_tokens` | integer | yes | | Total output tokens. |
| `cost_pence` | integer | yes | | Cost in pence, computed by `computeCostPence()` at write time. |
| `metadata` | jsonb | no | `{}` | Extra context. Currently used to record `toolTurns` when the web search loop runs more than one turn. |

**`metadata` JSONB shape:**
```typescript
{
  toolTurns?: number;  // present when the model call used the tool-use loop
}
```

---

## `approvals`

Workflow outputs held for human review before delivery. Created by `DestinationDispatcher` when a destination has `requireApproval: true`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `workflow_run_id` | uuid | no | | FK to `workflow_runs.id` |
| `status` | text | no | `'pending'` | `ApprovalStatus`: `pending`, `approved`, `rejected` |
| `reviewer_id` | uuid | yes | | FK to `users.id`. Set when a reviewer acts on the approval. |
| `decided_at` | timestamp | yes | | Set when approved or rejected. |
| `output_snapshot` | jsonb | no | | Snapshot of the workflow output at approval time. Buffers stripped. |

---

## `processed_external_ids`

Idempotency record. One row per Gmail message ID per client. Written for every message seen, whether it matched a routing rule or not.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `source` | text | no | | Always `gmail` currently. |
| `external_id` | text | no | | Gmail message ID. |
| `processed_at` | timestamp | no | | When the poller first processed this message. |

**Unique index:** `(client_id, source, external_id)`. Prevents the same message being persisted twice across concurrent poll cycles.

---

## `blog_posts`

Specialised output table for the `sprigly-blog-post` workflow. Written by `DbSaveBlogPost` in `packages/destinations/src/blog-post/db-save-blog-post.ts`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `title` | text | no | | |
| `slug` | text | no | | URL-safe slug, generated from title. Unique per client. |
| `body` | text | no | | Full blog post body in markdown. |
| `excerpt` | text | yes | | |
| `meta_description` | text | yes | | SEO meta description. |
| `target_keyword` | text | yes | | Primary SEO keyword. |
| `category` | text | yes | | |
| `author` | text | yes | | From `clientConfig.authorName` at run time. |
| `status` | text | no | `'draft'` | `BlogPostStatus`: `draft`, `review`, `published`, `archived` |
| `cta` | text | yes | | Call-to-action string. |
| `preview_token` | text | no | | Unique random token for preview URL. |
| `publish_token` | text | no | | Unique random token for publish action. |
| `research_notes` | text | yes | | Raw research output from the research step. |
| `faq` | jsonb | no | `[]` | Array of FAQ items. |

**`faq` JSONB element shape:**
```typescript
{
  question: string;
  answer: string;
}
```

**Unique indexes:** `preview_token` (global), `publish_token` (global), `(client_id, slug)`.

---

## `workflow_outputs`

Generic output store for workflows that do not have a specialised table. Currently used by `sprigly-prospect-research` and will be the default for all future workflows. Written by `DbSaveOutput` in `packages/destinations/src/generic/db-save-output.ts`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `workflow_run_id` | uuid | no | | FK to `workflow_runs.id` |
| `workflow_id` | text | no | | e.g. `sprigly-prospect-research` |
| `output` | jsonb | no | | Full workflow output, workflow-specific shape. |
| `status` | text | no | `'draft'` | `WorkflowOutputStatus`: `draft`, `delivered`, `archived` |

---

## `prospect_sheets`

Scaffolding table created in the initial migration before the generic `workflow_outputs` pattern was established. No longer written to by any production code path. Marked for removal in BACKLOG.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `brand_name` | text | no | | |
| `url` | text | yes | | |
| `sector` | text | yes | | |
| `research` | jsonb | no | `{}` | |
| `sheet_markdown` | text | yes | | |
| `notes` | text | yes | | |
| `meeting_date` | text | yes | | |

**Current vs intended:** `DbSaveProspectSheet` in `packages/destinations/src/prospect/db-save-prospect-sheet.ts` still exists as a class but is not registered with `DestinationDispatcher`. Prospect research output goes to `workflow_outputs` via `DbSaveOutput`. This table should be dropped once confirmed empty in production. See BACKLOG.

---

## `gmail_operation_errors`

Structured log of Gmail API failures. Written by `GmailPoller` when `markAsRead`, `createDraft`, or similar operations fail. Does not have `updated_at` (no updates, append-only).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `client_id` | uuid | no | | FK to `clients.id` |
| `operation` | text | no | | Which Gmail operation failed, e.g. `markAsRead`, `createDraft` |
| `external_id` | text | yes | | Gmail message ID, if relevant |
| `error_code` | text | yes | | HTTP status code or Google API error code |
| `error_message` | text | no | | Full error message string |
| `resolved` | boolean | no | `false` | Manually set to true via the admin UI once the error is acknowledged |
| `created_at` | timestamp | no | now() | |
| `resolved_at` | timestamp | yes | | Set when `resolved` is toggled true |

---

## `triage_configs`

Per-tenant configuration for the `sprigly-inbox-triage` workflow. One row per client. Loaded by `WorkflowRunner` when `rule.workflowId === 'sprigly-inbox-triage'` and injected into `WorkflowContext.triageConfig`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `categories` | jsonb | no | `[]` | Array of `TriageCategory`. Defines routing policy. |
| `voice_sample` | text | no | `''` | Founder writing style description. Injected into the classify prompt. |
| `reply_examples` | jsonb | no | `[]` | Array of `ReplyExample`. Injected into the classify prompt. |
| `additional_instructions` | text | yes | | Freeform overflow appended to assembled prompt. |

**`categories` JSONB element shape (`TriageCategory`, defined in `packages/engine/src/types.ts`):**
```typescript
{
  key: string;                    // stable identifier used in capture log
  label: string;                  // human-readable
  description: string;            // what this category means
  action: 'draft_reply' | 'escalate' | 'label' | `invoke_workflow:${string}`;
  graduationEligible: boolean;    // unused this build; must exist for future policy loop
  escalationReason?: string;      // default escalation reason for escalate-action categories
  escalationContext?: string;     // additional context for escalation
}
```

**`reply_examples` JSONB element shape (`ReplyExample`):**
```typescript
{
  inbound: string;   // the email being replied to
  reply: string;     // the exemplary reply in the founder's voice
  note?: string;     // optional annotation
}
```

---

## `triage_capture_log`

One row per triage suggestion, created by `sprigly-inbox-triage` for every classified email — including escalations, label actions, and workflow invocations, not just drafts. `decision` and `correction_type` are `null` until a human resolves via `recordResolution()`. Captures both approvals and corrections so denominators exist for the quarterly review.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `event_id` | uuid | no | | FK to `incoming_events.id` |
| `workflow_run_id` | uuid | no | | FK to `workflow_runs.id` |
| `category` | text | no | | The category key matched by the agent. |
| `suggested_action` | text | no | | The action the agent recommended. |
| `draft_text` | text | yes | | The draft reply text, if `suggested_action = draft_reply`. |
| `escalation_reason` | text | yes | | The escalation reason, if `suggested_action = escalate`. |
| `decision` | text | yes | | `TriageDecision`: `approved_as_is`, `modified`, `rejected`. Null until resolved. |
| `correction_type` | text | yes | | `CorrectionType`: `voice`, `substance`, `routing`, `none`. Inferred structurally by `recordResolution()`. Null until resolved. |
| `final_action` | text | yes | | Human's actual action, if different from suggestion. |
| `final_text` | text | yes | | Human's final text, if different from draft. |
| `decided_at` | timestamp | yes | | Set when the row is resolved. |
| `decided_by` | uuid | yes | | FK to `users.id`. Set when a named user resolves. |

**`correction_type` inference logic (in `packages/engine/src/resolution.ts`):**
- `approved_as_is` → `none`
- `rejected` → `routing`
- `modified`, action changed → `routing`
- `modified`, text growth >30% → `substance` (new facts added)
- `modified`, similar length → `voice` (style/tone edit)

---

## `triage_seen_messages`

The triage agent's own per-tenant processed-message seen-log. Decoupled from Gmail read-state and from the poller's `processed_external_ids` watermark. Written by `DbTriageStore.writeSeenMessage()` after successful classification. Unique on `(client_id, message_id)`.

The `thread_id` column is captured for future thread-level human-reply detection (if a thread already has a human reply the agent didn't author, treat as externally handled). The detection logic is not yet implemented; the column is present so it can be queried without a migration.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() | PK |
| `created_at` | timestamp | no | now() | |
| `updated_at` | timestamp | no | now() | |
| `client_id` | uuid | no | | FK to `clients.id` |
| `message_id` | text | no | | Gmail message ID. |
| `thread_id` | text | no | | Gmail thread ID. For future thread-level dedup. |
| `outcome` | text | no | | `WorkflowOutcome` at classification time. Currently always `needs_human`. |

**Unique index:** `(client_id, message_id)`. Insert uses `ON CONFLICT DO NOTHING`.

---

## Foreign key summary

```
users.client_id               → clients.id
client_configs.client_id      → clients.id
oauth_connections.client_id   → clients.id
routing_rules.client_id       → clients.id
routing_rules.client_config_id → client_configs.id
prompt_templates.client_id    → clients.id  (nullable; NULL = global default)
incoming_events.client_id     → clients.id
workflow_runs.event_id        → incoming_events.id
workflow_runs.client_id       → clients.id
audit_log.client_id           → clients.id
audit_log.event_id            → incoming_events.id  (nullable)
audit_log.workflow_run_id     → workflow_runs.id    (nullable)
approvals.workflow_run_id     → workflow_runs.id
approvals.reviewer_id         → users.id            (nullable)
processed_external_ids.client_id → clients.id
blog_posts.client_id          → clients.id
workflow_outputs.client_id    → clients.id
workflow_outputs.workflow_run_id → workflow_runs.id
prospect_sheets.client_id     → clients.id
gmail_operation_errors.client_id → clients.id
triage_configs.client_id          → clients.id
triage_capture_log.client_id      → clients.id
triage_capture_log.event_id       → incoming_events.id
triage_capture_log.workflow_run_id → workflow_runs.id
triage_capture_log.decided_by     → users.id  (nullable)
triage_seen_messages.client_id    → clients.id
```
