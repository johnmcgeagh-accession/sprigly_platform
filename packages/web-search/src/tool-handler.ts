import type { WebSearchProvider, SearchResult } from './types.js';

export function formatSearchResultsForModel(results: SearchResult[]): string {
  return results
    .map((r) => `**${r.title}**\n${r.url}\n${r.snippet}`)
    .join('\n\n---\n\n');
}

// Performs the search and formats results for model consumption.
// WebSearchError propagates — callers must not swallow it.
export async function handleWebSearchTool(
  provider: WebSearchProvider,
  query: string,
): Promise<{ results: string }> {
  const results = await provider.search(query);
  if (results.length === 0) return { results: '(no results)' };
  return { results: formatSearchResultsForModel(results) };
}
