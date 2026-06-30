# Web Search

## Purpose

`@sprigly/web-search` provides live web search to model steps that need grounded, current information. It wraps Tavily's search API behind a `WebSearchProvider` interface, exposes a custom tool definition that workflows pass to `ctx.model.complete()`, and handles the translation between the model's tool call and the search API response.

The package is designed so the search provider is swappable -- implement `WebSearchProvider` and register the new instance in `apps/worker/src/index.ts` without touching any workflow code.

---

## Interface

### `WebSearchProvider`

Defined in `packages/engine/src/types.ts` (the engine's copy is the canonical interface):

```typescript
interface WebSearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<SearchResult[]>;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;    // short relevance excerpt
  content?: string;   // longer raw content, if requested
  score?: number;     // provider relevance score
}
```

### `TavilyProvider`

`packages/web-search/src/tavily-provider.ts`. The production implementation. Constructor reads `TAVILY_API_KEY` from the environment and throws on startup if absent.

### `WEB_SEARCH_TOOL_DEFINITION`

`packages/web-search/src/tool-definition.ts`. The tool definition object to pass to `ModelCompleteParams.tools`. Shape:

```typescript
{
  name: 'web_search',
  description: 'Search the web for information about a company, person, or topic.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A short, specific search query (1-6 words)...'
      }
    },
    required: ['query']
  }
}
```

### `handleWebSearchTool(provider, query)`

`packages/web-search/src/tool-handler.ts`. Calls `provider.search(query)` and formats results for model consumption:

```
**Title**
https://url.example
Snippet text

---

**Title 2**
...
```

Returns `{ results: '(no results)' }` when the search returns an empty array. Propagates `WebSearchError` -- callers must not catch and swallow it.

### `WebSearchError`

`packages/web-search/src/types.ts`. Thrown by `TavilyProvider.search()` on any failure and by `handleWebSearchTool()` when it propagates from the provider. Extends `Error` with an `options` field containing `provider`, `query`, and optional `statusCode` and `cause`.

---

## Implementation notes

### Tavily query guard

`TavilyProvider.search()` checks the query string against `OPERATOR_RE` before making any API call:

```typescript
const OPERATOR_RE = /\bsite:|\bintitle:|\binurl:|\bfiletype:|"[^"]+"|\bOR\b|(?:^|\s)-\S/;
```

Queries matching this pattern are rejected with `WebSearchError` and a 400 status code. This prevents wasted API credits on queries Tavily will reject server-side anyway. The model must be instructed in the prompt not to use these operators. The prospect research prompts contain this instruction explicitly.

### Results format

`handleWebSearchTool()` formats results as `**Title**\nURL\nSnippet` sections separated by `---` dividers. This is the format the model sees in the `toolResult` content block. The `content` field (longer raw content) from Tavily is not currently surfaced to the model.

### Wiring into the model call

Workflows pass `WEB_SEARCH_TOOL_DEFINITION` in the `tools` array and a `toolHandlers` map to `ctx.model.complete()`. The tool-use loop in `BedrockClient` / `AnthropicClient` calls the handler each time the model invokes the tool. The loop continues until `stopReason != 'tool_use'` or `MAX_TOOL_TURNS = 20` is reached.

The workflow does not see individual search results -- only the final text output after all turns complete.

### Error propagation

`WebSearchError` thrown inside a `toolHandler` propagates up through the tool-use loop, out of `BedrockClient.complete()`, out of `WorkflowRunner.run()`, and is caught by the BullMQ job handler in `apps/worker/src/consumer.ts`. The job is marked as failed. `workflow_runs.error` receives the stringified error. The event status is set to `failed`.

There is no retry at the search level. If the error was transient (e.g. a Tavily 5xx), the job must be manually re-queued or the triggering email resent.

---

## How to extend

### Adding a new search provider

1. Create `packages/web-search/src/<provider>-provider.ts` implementing `WebSearchProvider`.
2. Add any required env vars to `apps/worker/src/env.ts`.
3. In `apps/worker/src/index.ts`, replace `new TavilyProvider()` with `new YourProvider()`.
4. Update `reference/env-vars.md` with the new variables.
5. No changes needed to workflows, tool definitions, or model clients.

### Changing the results format

Edit `formatSearchResultsForModel()` in `packages/web-search/src/tool-handler.ts`. The format affects what the model sees in each `toolResult` turn. Changing it may require prompt updates if the prompts reference specific format elements.

### Adjusting max results

Pass `{ maxResults: N }` as the `options` argument to `provider.search()`. Currently `handleWebSearchTool()` uses the provider's default (5 for Tavily). To change it, update the `handleWebSearchTool()` call site in the workflow's `toolHandlers` closure.

---

## Gotchas

**Natural language queries only.** Tavily's API rejects Google-style search operators. The `OPERATOR_RE` guard catches the most common patterns but cannot catch every possible mis-formatted query. Prompts must explicitly instruct the model to use natural language queries. The prospect research prompts do this; any new prompt that uses `web_search` must include the same instruction.

**No silent degradation.** `WebSearchError` is always re-thrown. A Tavily outage or quota exhaustion marks the entire workflow run as failed. There is no fallback to empty results or cached data. This is by design -- see `architecture/decisions.md` ADR 11.

**Search credits are consumed per query turn.** With `MAX_TOOL_TURNS = 20`, a worst-case prospect research run could issue up to 20 Tavily queries. At $0.04/search beyond the free tier, this is $0.80 in search costs alone for one run. Monitor Tavily dashboard for quota usage when running at scale.

**BACKLOG: `web_search_errors` table.** Tavily failures currently surface only in `workflow_runs.error` and Railway pino logs. They are not independently queryable. The BACKLOG contains a plan to add a `web_search_errors` table mirroring the `gmail_operation_errors` pattern.

---

## Cross-references

- `architecture/decisions.md` ADR 5 (Tavily over Anthropic built-in web_search)
- `architecture/decisions.md` ADR 11 (WebSearchError throws, no silent degradation)
- `architecture/decisions.md` ADR 12 (tool-use loop at model-client layer)
- `reference/api-tools.md` (web_search tool definition and wiring)
- `reference/env-vars.md` (TAVILY_API_KEY)
- `operations/troubleshooting.md` (Tavily operator rejection failure mode)
