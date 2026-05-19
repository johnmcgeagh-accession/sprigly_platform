# Glossary

Sprigly-specific terminology. These terms have precise meanings in the codebase; using them consistently avoids confusion when reading code or writing new workflows.

---

**Audit log**
A row in `audit_log` written after every model call. Records token counts, cost in pence, the physical model ID, and the workflow action name. Does not store prompts or model output. See `packages/audit/src/audit-logger.ts`.

**Brand voice**
Free text stored in `client_configs.brand_voice`. Injected into the blog post workflow's system prompt via `ctx.clientConfig.brandVoice`. Not used by the prospect research workflow.

**BullMQ job**
A unit of async work. The Gmail poller enqueues one job per incoming event. The consumer processes it. Queue name: `incoming-events`. Concurrency: 10. Connection: `REDIS_URL`.

**Client**
The top-level multi-tenant boundary. One row in `clients`. Identified by UUID. Every other table has a `client_id` column. All routing rules, OAuth tokens, prompts, events, and audit entries belong to a client.

**Client config**
A row in `client_configs`. Stores `brandVoice`, `authorName`, `signature`, and a freeform `settings` JSONB. Linked to routing rules via `client_config_id`. Loaded into `WorkflowContext.clientConfig` before a workflow run.

**Consumer**
The BullMQ worker in `apps/worker/src/consumer.ts`. Picks up jobs from the `incoming-events` queue, routes the event, runs matching workflows, and dispatches to destinations.

**Default destinations**
The delivery targets a workflow falls back to when a routing rule's `destinations` array is empty. Defined per workflow in `packages/engine/src/types.ts:Workflow.defaultDestinations` and overridden in the routing rule's `destinations` JSONB column. Resolved in `DestinationDispatcher.dispatch()`.

**Delivery context**
A `DeliveryContext` object passed to every destination's `deliver()` call. Contains `runId`, `workflowId`, and `clientId`. Defined in `packages/engine/src/types.ts`.

**Destination**
A class that knows how to deliver workflow output somewhere. Implements the `Destination` interface: `id`, `deliver()`, `requiresApproval()`. Registered with `DestinationDispatcher` at worker startup. Current destinations: `db-save-blog-post`, `db-save-output`, `gmail-send-notification`, `gmail-reply-with-attachment`.

**Destination config**
A `DestinationConfig` object: `destinationId`, optional `requireApproval`, and a `settings` map. Stored in `routing_rules.destinations` and in each workflow's `defaultDestinations`. Settings are destination-specific (e.g. `to`, `subjectTemplate`).

**Dry-run mode**
`WorkflowContext.dryRun = true`. Used by the eval harness. Audit logger skips DB writes and logs to console. Destinations must skip real delivery. Workflow logic runs unchanged.

**Eval harness**
`apps/worker/scripts/eval-harness.ts`. Runs workflows against real model providers using fixture inputs, without touching the production database. Used to test model parity between Anthropic and Bedrock providers.

**Event**
See **incoming event**.

**Fallback rule**
A routing rule with `is_fallback = true`. Only fires when no primary (non-fallback) rule matched the incoming event. Evaluated with the same condition logic as primary rules. See `infrastructure/routing.md`.

**Global prompt template**
A row in `prompt_templates` with `client_id = NULL`. Used as the default when no client-specific override exists. Seeded by migrations. Per-client overrides copy the global template and set `copied_from_template_id`.

**Idempotency record**
A row in `processed_external_ids`. Written for every Gmail message ID seen, regardless of whether it matched a routing rule. Prevents the same email from being processed twice across poll cycles.

**Incoming event**
A persisted record of a message that matched at least one routing rule. One row in `incoming_events`. Contains the source, metadata, and content of the original message. Messages that match no rules are not persisted as incoming events (only their external ID is tracked).

**Incoming event draft**
An in-memory `IncomingEventDraft` object built from a raw Gmail message before any DB writes. Used for rule matching. Contains `clientId`, `source`, `sourceMetadata`, and `content`. Defined in `packages/engine/src/types.ts`.

**Logical model name**
One of `haiku`, `sonnet`, `opus`. Declared per workflow step in `packages/workflows/src/meta.ts`. Resolved to a physical provider-specific model ID at runtime by `ResolvedModelClient`. Workflows never reference physical IDs directly.

**Match condition**
One element of a routing rule's `match_conditions` array. Specifies a `field`, an `op` (equals/contains/startsWith/endsWith/regex), a `value`, and optional `caseSensitive` flag. All conditions in a rule must pass for the rule to match (AND logic).

**Match-all rule**
A routing rule with an empty `match_conditions` array. Matches every incoming event from its source. Used when a client wants every email processed by a specific workflow.

**Physical model ID**
The provider-specific string passed to the model API. For Bedrock: a cross-region inference profile ID like `eu.anthropic.claude-haiku-4-5-20251001-v1:0`. For Anthropic direct: a model string like `claude-haiku-4-5`. Returned in `ModelCompleteResult.modelId` and stored in `audit_log.model_id`.

**Poller**
`packages/sources/src/gmail/gmail-poller.ts:GmailPoller`. Fetches unread messages from Gmail for each active client, matches rules, persists matched events, records idempotency, and enqueues BullMQ jobs.

**Priority**
An integer on a routing rule (`routing_rules.priority`). Rules are ordered by priority DESC when loaded by `EventRouter.loadRules()`. Higher number = evaluated first. Default 0.

**Prompt resolver**
`packages/prompts/src/index.ts:DbPromptResolver`. Resolves the prompt text for a given `(clientId, workflowId, stepName)` combination. Looks for a client-specific override first, then a global default. Throws if neither exists.

**Routing rule**
A configuration row in `routing_rules` that maps an event source and match conditions to a workflow. Determines what happens to an incoming event.

**Run ID**
The UUID of a `workflow_runs` row. Passed into `WorkflowContext.runId` and included in every audit log entry written during that run. Used to correlate model calls back to a specific workflow execution.

**Source type**
The channel an event arrived from. `SourceType`: `email`, `sms`, `slack`, `form`, `voice`, `webhook`, `schedule`. Only `email` (Gmail) is wired in the worker today. Defined in `packages/engine/src/types.ts`.

**Strip buffers**
`packages/engine/src/strip-buffers.ts`. Removes `Buffer` instances from workflow output before storing in JSONB. Prevents binary data (PDF bytes) from being persisted to `workflow_runs.output` and `approvals.output_snapshot`.

**Workflow**
A class implementing the `Workflow<TInput, TOutput>` interface: `id`, `defaultDestinations`, `parseInput()`, `run()`. Registered with `WorkflowRegistry` at worker startup. Defined in `packages/engine/src/types.ts`.

**Workflow context**
`WorkflowContext`. The object passed into `workflow.run()`. Provides `model`, `audit`, `prompts`, `search`, `clientConfig`, `clientId`, `eventId`, `runId`, and `dryRun`. Everything the workflow needs to execute without direct database access.

**Workflow output**
The return value of `workflow.run()`. Type is workflow-specific. Stored in `workflow_runs.output` (stripped of buffers) and passed to `DestinationDispatcher.dispatch()`.

**Workflow registry**
`packages/engine/src/workflow-registry.ts:WorkflowRegistry`. A simple map of `workflowId` to `Workflow` instance. Populated at worker startup in `apps/worker/src/index.ts`.

**Workflow run**
A row in `workflow_runs`. Created at the start of each workflow execution, updated on completion or failure.
