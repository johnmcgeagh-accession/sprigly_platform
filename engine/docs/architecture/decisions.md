# Architectural Decision Records

Significant decisions with context, alternatives, and consequences. Numbered for stable reference.

These are not aspirational -- they describe decisions that are live in the code as of 2026-05-19. When revisiting any of them, read the code first to confirm the implementation still matches.

---

### ADR 1: AWS Bedrock over direct Anthropic API for production inference

**Context:** Sprigly serves professional services clients in the UK. Many prospects and clients care about where their data is processed. Running inference via the Anthropic API sends prompts to Anthropic's US infrastructure. Running via Bedrock in `eu-west-2` with cross-region inference profiles keeps all inference traffic within the AWS EU boundary.

**Decision:** Use `MODEL_PROVIDER=bedrock` in production, routing to `eu.anthropic.*` cross-region inference profiles in `eu-west-2`. Keep `MODEL_PROVIDER=anthropic` as a dev and fallback option.

**Alternatives considered:**
- Direct Anthropic API throughout: Simpler, fewer env vars, no Bedrock account setup. Rejected because of EU data residency requirements.
- Azure OpenAI (different models): Rejected -- Sprigly's workflows are tuned for Claude's output style.

**Consequences:**
- EU data residency is maintained for all model calls. Important for sales conversations with GDPR-conscious clients.
- Bedrock cross-region profile IDs are versioned strings that expire when AWS retires model versions. They must be updated in env vars at each model update. Anthropic's direct API uses versionless aliases that Anthropic manages automatically. The `ARCHITECTURE.md` note on Bedrock IDs documents this operational cost.
- Bedrock inference costs approximately 15% more than direct Anthropic API due to the cross-region inference premium. Verified empirically across eval runs (see `operations/costs.md`).
- The Bedrock Converse API does not support Anthropic's built-in tools (e.g. `web_search_20250305`). Custom tools require an explicit `input_schema` in the tool definition. This is why Sprigly implements its own `web_search` tool via Tavily rather than using Anthropic's native. See ADR 5.
- Opus is not yet available on Bedrock `eu-west-2` (as of 2026-05-14). A support case is raised but unresolved. Until access is provisioned, all production workflows must use `haiku` or `sonnet`.

**Code references:** `packages/model-client/src/factory.ts`, `packages/model-client/src/bedrock-client.ts`, `ARCHITECTURE.md`.

---

### ADR 2: Generic `workflow_outputs` by default; specialised tables by exception

**Context:** Early development created a `prospect_sheets` table for the prospect research workflow, and a `blog_posts` table for the blog post workflow. Two specialised tables for two workflows raises the question: should every workflow get its own table?

**Decision:** New workflows write to the generic `workflow_outputs` table via `DbSaveOutput`. Specialised tables are created only when querying or rendering the output requires columns the generic shape cannot support efficiently. `blog_posts` was created before this pattern was established and remains. `prospect_sheets` was created as scaffolding and is now superseded -- it is marked for removal in BACKLOG.

**Alternatives considered:**
- A specialised table per workflow: Clean schema separation. Rejected because it creates a migration overhead for every new workflow and requires a dedicated destination class.
- A single generic table for everything including blog posts: Would have worked technically, but `blog_posts` already has specific columns (`preview_token`, `publish_token`, `slug`) used by the admin UI and preview feature. Migrating is not worth the cost.

**Consequences:**
- New workflows can write output to the DB without any schema migration -- just register `DbSaveOutput` as the destination.
- `workflow_outputs.output` is a freeform JSONB column. No schema enforcement on the output shape. Queries against specific output fields require JSONB operators.
- `blog_posts` is now an exception to the pattern. Anyone adding a feature to the admin UI that reads workflow outputs needs to know whether the workflow uses `blog_posts` or `workflow_outputs`.
- The BACKLOG item to drop `prospect_sheets` is a cleanup task, not a schema change with production impact. No data exists in that table.

**Code references:** `packages/db/src/schema.ts`, `packages/destinations/src/generic/db-save-output.ts`, `packages/destinations/src/blog-post/db-save-blog-post.ts`.

---

### ADR 3: react-pdf for PDF rendering

**Context:** The prospect research workflow produces a multi-page PDF brief. Three credible options existed.

**Decision:** Use `@react-pdf/renderer`. Components defined as React JSX in `packages/pdf-render/src/documents/ProspectBrief.tsx`.

**Alternatives considered:**
- Puppeteer (headless Chrome): Renders HTML to PDF. Rich CSS support, nearest to "how it looks in a browser." Rejected because it requires a headless Chrome binary in the deployment environment -- adds ~200 MB to the Docker image and significant startup time. Railway containers are relatively lightweight.
- pdfmake: Imperative API, good for tabular data. Rejected because the brief has a designed layout with branded sections that maps better to a component model than pdfmake's document definition format.

**Consequences:**
- PDF layout is expressed as React components. Anyone who writes React can read and modify the brief template.
- `@react-pdf/renderer` uses a subset of CSS Flexbox. Standard CSS properties like `grid`, `position: absolute`, and `overflow: hidden` are not supported. Some layout choices in the brief are constrained by what the renderer supports.
- Font registration must happen at module load time, not per render. `registerFonts()` in `packages/pdf-render/src/fonts.ts` is called once at the top of `sprigly-prospect-research.ts` via the `render.ts` import. Calling it multiple times is safe but redundant.
- No headless browser dependency. The Docker image stays small.

**Code references:** `packages/pdf-render/src/render.ts`, `packages/pdf-render/src/documents/`, `packages/pdf-render/src/fonts.ts`.

---

### ADR 4: Inter font instead of Plus Jakarta Sans

**Context:** Sprigly's original brand specification used Plus Jakarta Sans. The prospect brief PDF needs a well-rendered font that works reliably with `@react-pdf/renderer`.

**Decision:** Use Inter. Font files are bundled in `packages/pdf-render/fonts/inter/`.

**Alternatives considered:**
- Plus Jakarta Sans: The brand spec font. Rejected during PDF development because the renderer had issues with the variable font format used in the brand assets. Inter was already available in a compatible static format.

**Consequences:**
- The brief PDF does not match the brand spec exactly. The visual difference is minimal (both are geometric sans-serifs) but a designer looking closely will notice.
- If Plus Jakarta Sans is revisited, the font files need to be in a static (non-variable) format. The `fonts.ts` registration pattern already supports adding new font families.
- Inter is a well-tested font for `@react-pdf/renderer` with known-good weight coverage.

**Code references:** `packages/pdf-render/src/fonts.ts`, `packages/pdf-render/fonts/inter/`.

---

### ADR 5: Tavily over Anthropic's built-in web_search tool

**Context:** The prospect research workflow needs live web search to ground the output in current information about the target firm. Anthropic's Claude models have a built-in `web_search_20250305` tool.

**Decision:** Use Tavily as an external search provider via a custom `web_search` tool definition.

**Alternatives considered:**
- Anthropic built-in `web_search_20250305`: Would work with the direct Anthropic API. Rejected because Bedrock's Converse API does not support Anthropic's built-in tools -- they require tool schemas when passed via Converse. There is a workaround (provide an empty schema), but the built-in tool uses Anthropic's own search infrastructure, not a controllable third-party provider. Switching to Bedrock (ADR 1) made the built-in tool impractical.
- Google Custom Search / Bing: More complex setup, no obvious quality advantage for the use case.

**Consequences:**
- Tavily is a paid service ($0.04/search beyond the 1,000/month free tier as of 2026). Every prospect research run costs search credits proportional to the number of tool turns.
- Tavily rejects Google-style search operators (`site:`, `inurl:`, etc.). The prompt must instruct the model to use natural language queries only. The `TavilyProvider` also validates queries before sending and throws on operator detection. See `packages/web-search/src/tavily-provider.ts:OPERATOR_RE`.
- Switching search providers requires only implementing a new `WebSearchProvider` and registering it in `apps/worker/src/index.ts`. The workflow and tool-use loop are provider-agnostic.

**Code references:** `packages/web-search/src/tavily-provider.ts`, `packages/web-search/src/tool-definition.ts`, `packages/model-client/src/bedrock-client.ts:buildToolConfig()`.

---

### ADR 6: Prompts stored in the database, not in code

**Context:** Claude's output quality is highly sensitive to prompt text. Prompts need to be tweaked without a code deploy, and different clients may want different output styles.

**Decision:** All workflow prompts are stored in `prompt_templates` rows. Global defaults are seeded by migrations. Per-client overrides are written via the admin UI. Prompts are resolved at runtime by `DbPromptResolver`.

**Alternatives considered:**
- Prompts hardcoded in workflow files: Simplest. A prompt change requires a code deploy. Any client-specific variation requires a code branch.
- Prompts in config files (YAML/JSON in the repo): Versioned in git, easier to diff. Still requires a deploy to update in production.

**Consequences:**
- Prompts can be updated in production without a code deploy, via the admin UI at `/admin/prompts`.
- Different clients can have different prompt text for the same workflow step. This is the mechanism for white-labelling output style.
- Prompt text is not version-controlled in git. There is a `version` column and a `copied_from_template_id` provenance field, but diffs between prompt versions are not stored. Rollback requires knowing the previous prompt text.
- If no prompt exists for a `(clientId, workflowId, stepName)` combination, the workflow throws at runtime -- it does not fail silently with an empty prompt. This is by design.
- A workflow that lacks its global seed migration will fail at runtime for all clients, including Sprigly's own. This has happened with `sprigly-meeting-prep`, which has a placeholder prompt (`__PROMPT_NOT_CUSTOMISED__`) in its migration.

**Code references:** `packages/prompts/src/index.ts`, `packages/db/src/schema.ts:promptTemplates`, `apps/web/src/app/admin/prompts/`.

---

### ADR 7: `is:unread` query for Gmail polling (not watermark/history API)

**Context:** The Gmail poller needs to fetch new messages at each poll cycle without re-processing already-seen messages.

**Decision:** Query `in:inbox is:unread` via the Gmail Messages API on each poll cycle. Track seen message IDs in `processed_external_ids` for idempotency. Mark messages as read after processing to remove them from future poll results.

**Alternatives considered:**
- Gmail History API with a history ID watermark: The History API returns a delta of changes since a given `historyId`. This is the "canonical" approach for real-time Gmail sync. It was rejected because it requires persisting the latest `historyId` per client and handling the case where the history expires (which triggers a full resync). The `is:unread` approach is simpler and more recoverable from failures.
- Push notifications (Gmail Pub/Sub): True push delivery with near-zero latency. Rejected as over-engineered for the current scale. Requires a webhook endpoint, Pub/Sub setup, and more complex error recovery. Polling at 60-second intervals is adequate for the current use case.

**Consequences:**
- Poll latency is up to `POLL_INTERVAL_MS` (default 60 seconds) after a message arrives.
- Any message that is marked as read by the user before the next poll cycle will be missed. This is a known trade-off. Workflow triggers that arrive and are immediately read by the client will not be processed.
- The `processed_external_ids` table grows with every seen message ID. It does not have a TTL or cleanup mechanism. For high-volume inboxes this will grow without bound. This is not a concern at current scale.
- The current approach does not support processing historical messages. If a routing rule is added after an email arrived, that email will not be retroactively processed (the message was already marked read, so it won't appear in `is:unread` results).

**Code references:** `packages/sources/src/gmail/gmail-client.ts:listMessageIds()`, `packages/sources/src/gmail/gmail-poller.ts`.

---

### ADR 8: match-all + fallback rules, not per-client default workflows

**Context:** For some clients, every incoming email should trigger a specific workflow. A simpler design would be a "default workflow" setting per client.

**Decision:** Use the routing rule system for all cases. An empty `match_conditions` array matches every email. An `is_fallback = true` rule fires only when no other rule matched. There is no separate "default workflow" concept.

**Alternatives considered:**
- Per-client default workflow field: Simple to configure. Rejected because it creates two separate routing mechanisms -- the rule system and the default field. Any logic that determines "what runs for this event" must check two places.

**Consequences:**
- All routing is expressed as routing rules. One system, one admin UI section, one query path in the code.
- A misconfigured client with no rules and no fallback rule silently discards matching events. This is visible in `incoming_events.status = 'ignored'` but may be surprising.
- Routing rule priority and the fallback flag interact: a fallback rule does not fire if any non-fallback rule matched, regardless of priority. This is the correct behaviour but requires care when configuring rules that overlap in conditions.

**Code references:** `packages/engine/src/event-router.ts:matchRules()`, `packages/db/src/schema.ts:routingRules`.

---

### ADR 9: Two dedicated IAM users instead of shared AWS credentials

**Context:** The worker needs AWS access for two unrelated operations: Bedrock inference and KMS token encryption/decryption. Both could share a single IAM user.

**Decision:** Two dedicated IAM users:
- `sprigly-bedrock-worker`: `AmazonBedrockFullAccess` scoped to `eu-west-2`. Used only for model inference.
- `sprigly-kms-worker` (accessed via `KMS_AWS_*` env vars): `AWSKeyManagementServicePowerUser` scoped to a single KMS key ARN. Used only for OAuth token encryption.

The generic `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars are not used. Each SDK client receives explicit credentials at construction time via `BEDROCK_AWS_*` or `KMS_AWS_*` vars.

**Alternatives considered:**
- One IAM user with both permissions: Simpler credential management. Rejected because a compromised Bedrock key would also give access to decrypt OAuth tokens.
- IAM role (no access keys): The correct approach for ECS or other AWS-native deployments. Supported in the code (omitting both `BEDROCK_AWS_*` vars makes the Bedrock client use the ambient role). Not used for Railway deployments because Railway does not support IAM roles.

**Consequences:**
- Blast radius of a credential leak is limited. A leaked Bedrock key cannot decrypt OAuth tokens, and vice versa.
- Two IAM users to rotate credentials for instead of one.
- The generic `AWS_*` env vars being absent prevents accidental use of an overly broad credential that might exist in the environment. This has been a source of confusion: if `AWS_ACCESS_KEY_ID` is set in the environment by a CI/CD tool and the `BEDROCK_*` vars are not set, the Bedrock client will fail at startup rather than silently using the wrong credential.

**Code references:** `packages/model-client/src/factory.ts`, `packages/oauth-tokens/src/providers.ts`, `ARCHITECTURE.md`.

---

### ADR 10: BullMQ for the job queue

**Context:** Gmail polling runs on a fixed interval. Processing an email (running a workflow with multiple model calls) takes 10-180 seconds. Without a queue, the poll loop would either block or drop events.

**Decision:** Use BullMQ with Redis. The poller enqueues one job per `incoming_events` row. The BullMQ worker processes jobs with `concurrency: 10`.

**Alternatives considered:**
- Direct async processing (fire-and-forget): Simple. If the process restarts mid-workflow, the run is lost. No retry, no concurrency control.
- PostgreSQL-backed queue (SKIP LOCKED pattern): Eliminates the Redis dependency. More complex to implement. Not evaluated in detail -- BullMQ with Railway's managed Redis was faster to ship.

**Consequences:**
- A Redis instance is required in production. Railway provides this as a managed add-on.
- BullMQ handles retries and job failure tracking. A failed job (workflow threw an exception) is visible in Redis and in the worker's pino logs. It does not automatically retry by default with the current configuration.
- The `jobId` is set to the `eventId` UUID: `queue.add('process', { eventId }, { jobId: eventId })`. This makes BullMQ's deduplication by `jobId` equivalent to the idempotency already enforced by `processed_external_ids`. A duplicate enqueue will silently no-op.
- Concurrency of 10 means up to 10 model calls may be in flight simultaneously. At Bedrock's throttling limits this may cause `ThrottlingException`. The Bedrock client has a 3-retry exponential backoff for throttling (see ADR 12 and `infrastructure/model-client.md`).

**Code references:** `apps/worker/src/index.ts`, `apps/worker/src/consumer.ts`, `apps/worker/src/poller.ts`.

---

### ADR 11: WebSearchError throws immediately; no silent degradation

**Context:** When a Tavily API call fails (network error, 400 operator rejection, 5xx server error), the web search step gets no results. The design choice is whether to continue the workflow with partial data, or to fail loudly.

**Decision:** `WebSearchError` is thrown immediately. It propagates through the workflow, through the BullMQ job handler, and marks the `workflow_run` as `failed`. No fallback to empty results.

**Alternatives considered:**
- Return empty results on any error: The workflow would continue with a shallow brief. The client would receive a PDF with no real research. This is potentially worse than no PDF -- the client might act on it as if it were correct.
- Retry inside the tool handler: The Bedrock client already handles `ThrottlingException` retries. Adding retries for Tavily errors would mask transient failures but not Tavily outages.

**Consequences:**
- A Tavily outage or mis-configured query causes a visible job failure. The client gets no brief. This is better than a silently empty brief.
- Repeated failures due to a bad query pattern (e.g. the model generating queries with operators) will pile up as `workflow_run` failures. The admin `gmail-errors` and `events` UI pages make these visible.
- There is no fallback data source. If Tavily is down, prospect research does not run.
- The BACKLOG item to add `web_search_errors` table would make these failures independently queryable without scanning `workflow_runs.error`.

**Code references:** `packages/web-search/src/tavily-provider.ts`, `packages/web-search/src/types.ts`, `packages/workflows/src/sprigly-prospect-research/sprigly-prospect-research.ts`.

---

### ADR 12: Tool-use loop at the model-client layer, not per workflow

**Context:** Using tools (like web_search) requires a multi-turn conversation: the model requests a tool call, the application executes it, the result is appended to the conversation, and the model responds again. This loop could live in each workflow, or in the model client.

**Decision:** The tool-use loop lives entirely inside `BedrockClient.complete()` (and `AnthropicClient.complete()`). Workflows call `ctx.model.complete()` once and receive the final text response. The loop is invisible to the workflow.

**Alternatives considered:**
- Loop in the workflow: Each workflow controls the conversation turns. More flexible (a workflow could inspect intermediate tool results and change direction). Rejected because it duplicates loop logic across workflows and exposes provider-specific concerns (Bedrock turn structure, tool result format) to workflow code.

**Consequences:**
- Workflows are simpler. They make one `complete()` call per step, regardless of how many tool turns happen internally.
- The total token count returned by `complete()` is the sum across all turns, not per turn. Audit logging records the cumulative cost for the whole step.
- The tool-use loop has a hard cap of `MAX_TOOL_TURNS = 20`. When this is hit, the client injects a user message asking the model to summarise, strips all tool use/result blocks from the history, and sends one final text-only request. This is the force-summarise behaviour. Log line: `[bedrock] max tool turns (20) reached for model=...`. The final output may be shallower than a full-research run -- this is a deliberate trade-off over an infinite loop.
- A workflow cannot inspect intermediate tool results. If a search returns nothing useful, the model decides how to adapt. The workflow only sees the final text.
- `AnthropicClient` implements the same interface. If the tool-use loop behaviour needs to differ between providers (e.g. different max turns), both clients would need updating.

**Code references:** `packages/model-client/src/bedrock-client.ts:complete()`, `packages/model-client/src/anthropic-client.ts`, `packages/model-client/src/types.ts:ModelCompleteParams`.
