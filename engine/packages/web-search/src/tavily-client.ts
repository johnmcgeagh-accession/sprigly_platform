import { tavily } from '@tavily/core';
import type { WebSearchProvider, SearchResult } from './types.js';

export class TavilyClient implements WebSearchProvider {
  private client: ReturnType<typeof tavily>;

  constructor(apiKey: string) {
    this.client = tavily({ apiKey });
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const response = await this.client.search(query, { maxResults: 5 });
      return (response.results ?? []).map((r) => ({
        title:   r.title   ?? '',
        url:     r.url     ?? '',
        content: r.content ?? '',
      }));
    } catch (err) {
      console.warn(`[tavily] search failed for "${query}":`, err);
      return [];
    }
  }
}
