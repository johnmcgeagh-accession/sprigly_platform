# Workflow Anatomy

## What a workflow is

A workflow is an object implementing the `Workflow<TInput, TOutput>` interface defined in `packages/engine/src/types.ts`:

```typescript
interface Workflow<TInput = unknown, TOutput = unknown> {
  id: string;
  defaultDestinations: DestinationConfig[];
  parseInput(event: IncomingEvent): TInput | null;
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
}
```

Four members:

| Member | What it does |
|---|---|
| `id` | Stable string identifier, e.g. `sprigly-prospect-research`. Must match what's in `routing_rules.workflow_id` and `prompt_templates.workflow_id`. |
| `defaultDestinations` | Where to deliver output when a routing rule's `destinations` array is empty. Overridable per routing rule. |
| `parseInput(event)` | Extracts structured input from an `IncomingEvent`. Returns `null` if the event does not match (e.g. wrong subject prefix). A `null` return short-circuits the run -- the event is marked `ignored` and no model calls are made. |
| `run(input, ctx)` | Executes the workflow steps. Receives structured input and the `WorkflowContext`. Returns a typed output object. Any unhandled throw marks the run as `failed`. |

Workflows live in `packages/workflows/src/<workflow-id>/`. The entry point file is `<workflow-id>.ts`. Input and output types are in `types.ts`. Input parsing is in `parse-input.ts`.

---

## WorkflowContext

`run()` receives a `WorkflowContext` as its second argument. This object provides everything the workflow needs to execute:

```typescript
interface WorkflowContext {
  clientId: string;
  clientConfig: ClientConfig;
  model: ModelClient;
  audit: AuditLogger;
  prompts: PromptResolver;
  eventId: string;
  runId: string;
  search?: WebSearchProvider;
  dryRun?: boolean;
}
```

| Field | Type | What it gives you |
|---|---|---|
| `clientId` | `string` | UUID of the client whose event triggered this run. Pass to `audit.logModelCall()` and `prompts.resolve()`. |
| `clientConfig` | `ClientConfig` | Brand voice, author name, signature, and freeform settings. Use to personalise system prompts. |
| `model` | `ModelClient` | The single entry point for model inference. Call `ctx.model.complete(params)` for each step. |
| `audit` | `AuditLogger` | Call `ctx.audit.logModelCall(...)` after each model call to record token usage and cost. |
| `prompts` | `PromptResolver` | Call `ctx.prompts.resolve(clientId, workflowId, stepName)` to fetch the live prompt text from the database. |
| `eventId` | `string` | UUID of the `incoming_events` row. Pass to `audit.logModelCall()` for traceability. |
| `runId` | `string` | UUID of the `workflow_runs` row. Pass to `audit.logModelCall()`. |
| `search` | `WebSearchProvider?` | Tavily search. Present in production. May be `undefined` in tests that don't inject it. Always guard: `if (ctx.search === undefined)`. |
| `dryRun` | `boolean?` | When `true`, skip real delivery. Used by the eval harness. Workflows themselves ignore this; destinations and audit logger check it. |

---

## Email input parsing

All three current workflows are triggered by email. Input parsing follows a shared pattern: `parseEmailInput()` from `packages/sources/src/email-parser/index.ts` extracts the primary value from the subject line and optional structured fields from the body.

**Subject format:** `<Prefix>: <primary value>`

**Body format:**
```
Field name: value on same line
Notes: multi-line value continues
on subsequent lines until the next field declaration
```

Each workflow defines an `EmailInputSpec` with its `subjectPrefix` and expected `bodyFields` (including aliases for flexible label matching). `parseEmailInput()` returns `null` if the subject does not start with the prefix.

| Workflow | Subject prefix | Primary value | Optional body fields |
|---|---|---|---|
| `sprigly-blog-post` | `Blog:` | topic | (none) |
| `sprigly-prospect-research` | `Prospect:` | brandName | `url`, `sector`, `meetingDate`, `whyInterested`, `notes` |
| `sprigly-meeting-prep` | `Meeting Prep:` | topic | `notes` |

Note: `sprigly-blog-post` does not use `parseEmailInput()` -- it handles parsing inline in `parseBlogPostInput()` with a simple `startsWith` check and no body fields.

---

## Step pattern

A workflow step is a `ctx.model.complete()` call followed by a `ctx.audit.logModelCall()` call. Every step follows this shape:

```typescript
// 1. Resolve prompt from DB
const prompt = await ctx.prompts.resolve(ctx.clientId, 'workflow-id', 'step-name');

// 2. Substitute template variables
const message = fillTemplate(prompt, { key: value, ... });

// 3. Call the model
const result = await ctx.model.complete({
  model: 'haiku',    // logical name
  system: '...',     // optional
  messages: [{ role: 'user', content: message }],
  maxTokens: 4096,
  // tools / toolHandlers if this step uses web_search
});

// 4. Log audit record
await ctx.audit.logModelCall({
  clientId: ctx.clientId,
  eventId: ctx.eventId,
  runId: ctx.runId,
  modelId: result.modelId,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  action: 'step-name',
});

// 5. Parse result.content into typed data
const parsed = extractJson(result.content);
```

`result.content` is the final text from the model after all tool turns. If the step uses tools, `result.toolTurns` will be set to the number of turns taken.

---

## Shared vs hardcoded vs prompt-controlled

This table maps each aspect of each workflow to one of three categories:

- **Shared:** comes from the engine, a package, or a runtime service. The same code serves all workflows.
- **Hardcoded:** baked into the workflow's TypeScript. Changing it requires a code deploy.
- **Prompt-controlled:** lives in `prompt_templates` rows in the database. Changeable at runtime via the admin UI, per client.

### `sprigly-prospect-research`

| Aspect | Category | Detail |
|---|---|---|
| Model inference | Shared | `ctx.model.complete()` via `BedrockClient` or `AnthropicClient` |
| Audit logging | Shared | `ctx.audit.logModelCall()` writes to `audit_log` |
| Prompt text lookup | Shared | `ctx.prompts.resolve()` reads `prompt_templates` with client-override fallback |
| Web search | Shared | `ctx.search` (TavilyProvider). Up to 20 tool turns. |
| DB save | Shared | `db-save-output` destination writes to `workflow_outputs` |
| PDF reply | Shared | `gmail-reply-with-attachment` destination builds and sends MIME email |
| PDF renderer | Shared | `render('prospect-brief', data)` via `@react-pdf/renderer` |
| Subject prefix | Hardcoded | `'Prospect:'` in `PROSPECT_SPEC` (`parse-input.ts`) |
| Model | Hardcoded | `sonnet` for both research and write steps; not client-configurable |
| Number of steps | Hardcoded | 3: research, write, render-pdf |
| Write system prompt | Hardcoded | `WRITE_SYSTEM` constant in `sprigly-prospect-research.ts`: enforces JSON-only output and bans em-dashes |
| Output normalisation | Hardcoded | `normalizeBriefData()` coerces raw LLM JSON into `ProspectBriefData`; applies `safeString`/`safeArray` fallbacks |
| No-data threshold | Hardcoded | If `ctx.search` is present, `searchCount.total >= 10`, and all searches returned no results, skip write step and return `renderNoData()` |
| Summary bullet derivation | Hardcoded | `summaryBullet1` from `execSummary.whatTheyActuallyDo`; `summaryBullet2`/`3` from first pipeline/risk |
| Email reply template variables | Hardcoded | `{{brandName}}`, `{{summaryBullet1}}`, `{{summaryBullet2}}`, `{{summaryBullet3}}` in `defaultDestinations` |
| What to search for | Prompt-controlled | Research step prompt (`workflow_id='sprigly-prospect-research'`, `step_name='research'`) |
| Research depth and focus areas | Prompt-controlled | Research step prompt |
| Write output schema | Prompt-controlled | Write step prompt (`step_name='write'`): instructs model to produce JSON matching `ProspectBriefData` |
| Tone of the brief | Prompt-controlled | Write step prompt |

### `sprigly-blog-post`

| Aspect | Category | Detail |
|---|---|---|
| Model inference | Shared | `ctx.model.complete()` |
| Audit logging | Shared | `ctx.audit.logModelCall()` |
| Prompt text lookup | Shared | `ctx.prompts.resolve()` |
| DB save | Shared | `db-save-blog-post` destination writes to `blog_posts` |
| Subject prefix | Hardcoded | `'Blog:'` in `parseBlogPostInput()` |
| Number of steps | Hardcoded | 3: research, structure, write |
| Default model | Hardcoded | `haiku` (read from `clientConfig.settings['model']`, defaulting to `'haiku'` if absent) |
| Model override | Shared (per client) | `clientConfig.settings['model']` can be set to `'sonnet'` or `'opus'` per client without a code change |
| System prompt construction | Hardcoded | `buildSystemPrompt()` injects `clientConfig.authorName` and `clientConfig.brandVoice` as fixed strings |
| Output shape | Hardcoded | `BlogPostOutput` fields; slug generated by `generateSlug(title)` |
| Research angles and FAQ format | Prompt-controlled | Research step prompt (`step_name='research'`): defines the JSON structure the model must produce |
| Post title / excerpt / meta | Prompt-controlled | Structure step prompt (`step_name='structure'`): defines what structured fields to produce |
| Post body style and length | Prompt-controlled | Write step prompt (`step_name='write'`): defines tone, word count, heading structure |

### `sprigly-meeting-prep` (scaffolded skeleton -- not registered with worker)

| Aspect | Category | Detail |
|---|---|---|
| Model inference | Shared | `ctx.model.complete()` |
| Audit logging | Shared | `ctx.audit.logModelCall()` |
| Prompt text lookup | Shared | `ctx.prompts.resolve()` |
| DB save | Shared | `db-save-output` destination |
| Subject prefix | Hardcoded | `'Meeting Prep:'` in `SPEC` (`parse-input.ts`) |
| Number of steps | Hardcoded | 1: generate. Only step. Comment says "add further steps here." |
| Model | Hardcoded | `sonnet` |
| Sentinel guard | Hardcoded | If resolved prompt contains `__PROMPT_NOT_CUSTOMISED__`, throws immediately rather than running with a placeholder. This is the only workflow that has this guard. |
| Output | Hardcoded | `{ text: result.content }` -- raw model text, no parsing or structuring |
| Everything about the output | Prompt-controlled | The generate prompt contains only a placeholder. The entire output shape and behaviour depends on a real prompt being written. |

---

## Lifecycle: event to output

```
IncomingEvent (from DB)
  │
  ├─ workflow.parseInput(event)
  │    Returns TInput | null
  │    null → run status: ignored, return
  │
  ├─ Step 1 (and N more steps)
  │    prompts.resolve(clientId, workflowId, stepName)
  │    model.complete({ model, system, messages, tools? })
  │    audit.logModelCall(...)
  │
  └─ return TOutput
       │
       └─ DestinationDispatcher.dispatch(output, event, rule, runId)
            For each DestinationConfig:
              destination.deliver(output, event, config, ctx)
```

`WorkflowRunner.run()` in `packages/engine/src/workflow-runner.ts` manages the DB state transitions (workflow_run row, incoming_event status) around this lifecycle. The workflow itself is not responsible for any DB writes beyond what it does via `ctx.audit`.

---

## What a workflow is not responsible for

Understanding the boundaries is as important as understanding what workflows do:

- **Routing:** The engine decides which workflow runs. The workflow never looks at the routing rule.
- **Idempotency:** Handled by `processed_external_ids` in the poller. The workflow will not be called twice for the same event.
- **Job queuing:** The consumer and BullMQ handle this. By the time `workflow.run()` is called, the job is already in flight.
- **Delivery:** The workflow returns output and the `DestinationDispatcher` delivers it. The workflow does not call destinations directly.
- **Status tracking:** `WorkflowRunner` sets `workflow_runs.status` and `incoming_events.status`. The workflow does not interact with these tables.
- **Error recovery:** An unhandled throw from `workflow.run()` propagates to the BullMQ job handler. BullMQ marks the job as failed. No automatic retry is configured.
