import { tavily } from '@tavily/core';
import type { WebSearchProvider, SearchResult, WebSearchOptions } from './types.js';
import { WebSearchError } from './types.js';

// Detects Google-style operators that Tavily rejects with HTTP 400.
const OPERATOR_RE = /\bsite:|\bintitle:|\binurl:|\bfiletype:|"[^"]+"|\bOR\b|(?:^|\s)-\S/;

export class TavilyProvider implements WebSearchProvider {
  private readonly client: ReturnType<typeof tavily>;

  constructor() {
    const apiKey = process.env['TAVILY_API_KEY'];
    if (!apiKey) throw new Error('TAVILY_API_KEY env var is required');
    this.client = tavily({ apiKey });
  }

  async search(query: string, options?: WebSearchOptions): Promise<SearchResult[]> {
    if (OPERATOR_RE.test(query)) {
      throw new WebSearchError(
        `Query contains unsupported search operators: "${query}". Tavily requires natural language queries only. ` +
        `Remove site:, intitle:, inurl:, quoted phrases, and minus operators.`,
        { provider: 'tavily', query, statusCode: 400 },
      );
    }
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
