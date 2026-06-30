# API Tools

Custom tools available to models during workflow execution. These are the functions Claude can call while running a step.

As of 2026-05-19, one tool is registered: `web_search`.

---

## `web_search`

Lets the model search the web during a step. The tool bridges the model's tool-use request to the `TavilyProvider` and returns structured results.

### Tool definition

Defined in `packages/web-search/src/tool-definition.ts`:

```typescript
export const WEB_SEARCH_TOOL_DEFINITION = {
  name: 'web_search',
  description: 'Search the web for information about a company, person, or topic.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'A short, specific search query (1-6 words). Use source-specific terms like ' +
          '"site:linkedin.com" when appropriate. Do not repeat a query you have already used.',
      },
    },
    required: ['query'],
  },
} as const;
```

### Handler

The tool handler lives in `packages/web-search/src/tool-handler.ts`. It is wired into the model call inside the workflow that uses it -- not globally. Currently only `sprigly-prospect-research` passes this tool to `ModelClient.complete()`.

`handleWebSearchTool()` calls `WebSearchProvider.search(query)` and formats the results for the model:

```typescript
// Rough shape of what the model receives back
{
  results: "Title: ...\nURL: ...\nSnippet: ...\n\n..."
  // or: "(no results)"
}
```

### Limitations

- **Natural language queries only.** Tavily rejects queries containing Google-style operators: `site:`, `intitle:`, `inurl:`, `filetype:`, quoted phrases, and leading minus operators. The `TavilyProvider` in `packages/web-search/src/tavily-provider.ts` checks for these with a regex before making the API call and throws `WebSearchError` with a 400 status if any are found. This means prompts must explicitly instruct the model not to use these operators.

- **5 results by default.** The `maxResults` option defaults to 5. Adjustable via `WebSearchOptions` but not currently overridden in production.

- **No error degradation.** If the search fails for any reason (Tavily API error, network failure, operator rejection), a `WebSearchError` is thrown. The error propagates up through the workflow, marks the `workflow_run` as `failed`, and the BullMQ job is marked as failed. There is no fallback to a cached or empty result. See `architecture/decisions.md` ADR 11.

### Wiring: how the tool reaches the model

In `sprigly-prospect-research`:

1. `WEB_SEARCH_TOOL_DEFINITION` is passed to `ctx.model.complete({ tools: [WEB_SEARCH_TOOL_DEFINITION] })`.
2. `BedrockClient` translates the Anthropic-format tool definition to the Bedrock `ToolConfiguration` format in `buildToolConfig()` (`packages/model-client/src/bedrock-client.ts:29`).
3. The Bedrock Converse API calls the tool by returning `stopReason: 'tool_use'` with a `toolUse` content block.
4. `BedrockClient.complete()` dispatches to `toolHandlers['web_search']`, which calls `handleWebSearchTool()`.
5. The result is appended as a `toolResult` user message and the loop continues.
6. This repeats up to `MAX_TOOL_TURNS = 20` times.

The tool-use loop lives entirely inside `BedrockClient`, not inside the workflow. See `architecture/decisions.md` ADR 12.

### Adding a new tool

1. Define the tool in `packages/web-search/src/` or a new package.
2. Export a `TOOL_DEFINITION` constant in Anthropic tool format (name, description, input_schema).
3. Export a handler function `(input: unknown) => Promise<unknown>`.
4. In the workflow step that needs the tool, pass both to `ctx.model.complete({ tools: [...], toolHandlers: { toolName: handler } })`.
5. Update `workflows/existing.md` to note which step uses the tool and under what conditions.

No changes needed to `BedrockClient` or `AnthropicClient` -- both handle arbitrary tools generically.
