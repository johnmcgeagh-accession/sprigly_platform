import { tavily } from '@tavily/core';
import type { WebSearchProvider, SearchResult, WebSearchOptions } from './types.js';
import { WebSearchError } from './types.js';

export class TavilyProvider implements WebSearchProvider {
  private readonly client: ReturnType<typeof tavily>;

  constructor() {
    const apiKey = process.env['TAVILY_API_KEY'];
    if (!apiKey) throw new Error('TAVILY_API_KEY env var is required');
    this.client = tavily({ apiKey });
  }

  async search(query: string, options?: WebSearchOptions): Promise<SearchResult[]> {
    try {
      const response = await this.client.search(query, {
        maxResults: options?.maxResults ?? 5,
        ...(options?.searchDepth !== undefined && { searchDepth: options.searchDepth }),
        ...(options?.includeDomains !== undefined && { includeDomains: options.includeDomains }),
        ...(options?.excludeDomains !== undefined && { excludeDomains: options.excludeDomains }),
      });
      return (response.results ?? []).map((r) => ({
        title:   r.title   ?? '',
        url:     r.url     ?? '',
        snippet: r.content ?? '',
        ...(r.rawContent !== undefined && { content: r.rawContent }),
        score: r.score,
      }));
    } catch (err) {
      const statusCode = extractStatusCode(err);
      throw new WebSearchError(
        `Tavily search failed for query "${query}": ${String(err)}`,
        { provider: 'tavily', query, ...(statusCode !== undefined && { statusCode }), cause: err },
      );
    }
  }
}

function extractStatusCode(err: unknown): number | undefined {
  if (err != null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e['status'] === 'number') return e['status'];
    if (typeof e['statusCode'] === 'number') return e['statusCode'];
  }
  return undefined;
}
