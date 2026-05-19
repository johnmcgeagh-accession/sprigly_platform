# Model Client

## Purpose

`@sprigly/model-client` abstracts all model inference behind a single `ModelClient` interface. Workflows call `ctx.model.complete()` without knowing which provider is active or what physical model ID is in use. The package provides two concrete implementations (`BedrockClient` and `AnthropicClient`), a logical-to-physical ID translation layer (`ResolvedModelClient`), and a factory function that constructs the right client from environment variables at startup.

The tool-use conversation loop lives here, not in workflows. When a model step uses tools (e.g. `web_search`), the client handles all turn management internally and returns a single `ModelCompleteResult` to the caller.

---

## Interface

### `ModelClient`

Defined in `packages/model-client/src/types.ts`:

```typescript
interface ModelClient {
  complete(params: ModelCompleteParams): Promise<ModelCompleteResult>;
}
```

**`ModelCompleteParams`:**

| Field | Type | Notes |
|---|---|---|
| `model` | `string` | Logical name (`haiku`, `sonnet`, `opus`) or a physical ID. Resolved by `ResolvedModelClient` before reaching the provider. |
| `system` | `string?` | System prompt. Optional. |
| `messages` | `Array<{role, content}>` | Conversation history. Both providers accept `user` and `assistant` roles. |
| `maxTokens` | `number?` | Max output tokens. Defaults to 4096 in both clients. |
| `tools` | `unknown[]?` | Tool definitions in Anthropic format (`name`, `description`, `input_schema`). |
| `toolHandlers` | `Record<string, (input: unknown) => Promise<unknown>>?` | Handler functions keyed by tool name. Called during the tool-use loop. |

**`ModelCompleteResult`:**

| Field | Type | Notes |
|---|---|---|
| `content` | `string` | Final text output after all tool turns. |
| `inputTokens` | `number` | Total input tokens across all turns. |
| `outputTokens` | `number` | Total output tokens across all turns. |
| `modelId` | `string` | The physical model ID actually used. Stored in `audit_log.model_id`. |
| `stopReason` | `string` | Final stop reason from the provider (`end_turn`, `max_tokens`, etc.). |
| `toolTurns` | `number?` | Present only when the tool-use loop ran more than one turn. Written to `audit_log.metadata`. |

### `createModelClientFromEnv()`

`packages/model-client/src/factory.ts`. Called once at worker startup in `apps/worker/src/index.ts`. Reads `MODEL_PROVIDER` and constructs the appropriate client. Throws with a formatted Zod error message if required env vars are missing -- the worker exits rather than starting in a broken state.

Returns a `ResolvedModelClient` wrapping either `BedrockClient` or `AnthropicClient`.

### `ResolvedModelClient`

`packages/model-client/src/model-resolver.ts`. Wraps a `ModelClient`. Translates logical names to physical IDs at call time using a map built at construction. Logical names are: `haiku`, `sonnet`, `opus`.

- Known logical name in the map: resolved to the physical ID.
- Known logical name NOT in the map: throws immediately (catches misconfigured env vars at first use, not just startup).
- Any other string (already a physical ID): forwarded as-is. This backwards-compatibility path is rarely used in practice.

---

## Implementation notes

### BedrockClient

`packages/model-client/src/bedrock-client.ts`. Uses AWS SDK `BedrockRuntimeClient` with the `ConverseCommand`.

**Tool-use loop** (`complete()`, line ~113):

```
for turn in 0..MAX_TOOL_TURNS:
  send ConverseCommand
  if stopReason != 'tool_use': break

  append assistant turn to messages
  execute all tool_use blocks via toolHandlers
  append tool_result user turn to messages

  if turn == MAX_TOOL_TURNS - 1:
    inject summarise user message
    strip all non-text blocks from history
    send one final ConverseCommand with no toolConfig
    break
```

**Force-summarise at `MAX_TOOL_TURNS = 20`:**
When the loop reaches turn 20, the client:
1. Appends the last assistant turn to the message history.
2. Pushes a user message: `"You have reached the search limit. Please now write up all the research you have gathered into a comprehensive summary."`
3. Filters the entire message history down to text-only content blocks (strips all `toolUse` and `toolResult` blocks). Any message that becomes empty after filtering is also removed.
4. Sends one final `ConverseCommand` without `toolConfig` (no tools available, forces a text-only response).
5. Returns whatever text the model produces in that final turn.

The log line for this is: `[bedrock] max tool turns (20) reached for model=... Forcing summarise turn.`

If the summarise turn also produces a short or unhelpful response, there is no retry. The output is whatever the model wrote -- which may be a shallow brief. This is the expected trade-off. See `architecture/decisions.md` ADR 12.

**Throttle retry:**
`sendWithRetry()` retries `ThrottlingException` (HTTP 429) up to 3 times with exponential backoff starting at 1 second. Log prefix: `[bedrock] ThrottlingException — retrying`.

**Timeout:**
Each individual `ConverseCommand` has a 180-second abort signal (`DEFAULT_TIMEOUT_MS = 180_000`). If the abort fires, the error message includes the model ID and timeout duration.

**`buildToolConfig()`:**
Translates Anthropic-format tool definitions to Bedrock's `ToolConfiguration` format. Critical detail: Anthropic built-in tools (e.g. `web_search_20250305`) have no `input_schema`. Bedrock's Converse API rejects a tool without a schema. `buildToolConfig()` substitutes an empty object schema (`{ type: 'object', properties: {} }`) when `input_schema` is absent. This makes passing Anthropic built-in tools to Bedrock technically non-fatal, but those tools do not function -- Bedrock does not route them to Anthropic's infrastructure. Use only custom tools via Bedrock.

### AnthropicClient

`packages/model-client/src/anthropic-client.ts`. Uses `@anthropic-ai/sdk`. Implements the same tool-use loop with the same `MAX_TOOL_TURNS = 20` cap and the same force-summarise behaviour. The Anthropic client does not need the `buildToolConfig()` workaround -- it accepts Anthropic-format tools directly.

Key difference from Bedrock: on the AnthropicClient, when the force-summarise turn fires, the full `response.content` (including tool use blocks) is appended to the message history before pushing the summarise user message. Bedrock does not support this (the history must be text-only), so the Bedrock client strips non-text blocks instead.

---

## How to extend

### Adding a new model provider

1. Create `packages/model-client/src/<provider>-client.ts` implementing `ModelClient`.
2. Add the provider to the `baseSchema` enum in `factory.ts`: `MODEL_PROVIDER: z.enum(['anthropic', 'bedrock', '<new>'])`.
3. Add a Zod schema for the new provider's env vars (follow the `bedrockSchema` pattern).
4. Add a branch in `createModelClientFromEnv()` that parses the schema and returns the new client wrapped in `ResolvedModelClient`.
5. Update `reference/env-vars.md` with the new variables.
6. Update `architecture/decisions.md` with an ADR for the provider choice.

### Changing the force-summarise message

Edit the user message text at `packages/model-client/src/bedrock-client.ts` (line ~157) and the corresponding line in `anthropic-client.ts` (line ~58). Both must stay in sync.

### Changing `MAX_TOOL_TURNS`

Edit the constant at the top of both `bedrock-client.ts` and `anthropic-client.ts`. They are independent constants -- both must be updated.

---

## Gotchas

**Bedrock model IDs expire.** Cross-region inference profile IDs like `eu.anthropic.claude-haiku-4-5-20251001-v1:0` are versioned strings. When AWS retires a model version, the ID stops working and requests return a `ResourceNotFoundException`. There is no automatic fallback. Update `BEDROCK_MODEL_ID_*` env vars and redeploy. The Anthropic direct API uses versionless aliases that Anthropic manages; this problem does not apply to `MODEL_PROVIDER=anthropic`.

**Opus is not yet available on Bedrock eu-west-2.** `BEDROCK_MODEL_ID_OPUS` is validated at startup but no workflow currently uses `opus`. The env var must be set to a non-empty string, but attempting to use it will fail at inference time. See `ARCHITECTURE.md`.

**Bedrock does not support Anthropic built-in tools.** Do not pass `web_search_20250305` or other built-in tool names to `BedrockClient`. The `buildToolConfig()` workaround will produce a malformed schema and the tool will silently do nothing. Use custom tools with explicit `input_schema` instead. See ADR 5.

**Token counts are cumulative.** `ModelCompleteResult.inputTokens` and `outputTokens` are summed across all tool turns. A research step with 15 tool turns will report the total token cost, not the cost of the final text turn only. The `toolTurns` field records how many turns occurred.

**`ResolvedModelClient` builds the ID map at construction, not per call.** If env vars change after startup (e.g. in tests that modify `process.env`), the in-memory map is stale. In tests, construct a new `ResolvedModelClient` with the updated map rather than relying on `process.env` changes to propagate.

---

## Cross-references

- `architecture/decisions.md` ADR 1 (Bedrock over Anthropic direct)
- `architecture/decisions.md` ADR 9 (dedicated IAM users)
- `architecture/decisions.md` ADR 12 (tool-use loop at model-client layer)
- `reference/env-vars.md` (model provider env vars)
- `operations/troubleshooting.md` (Bedrock ID expiry, Opus provisioning, throttling)
