export interface WebSearchOptions {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;   // short relevance excerpt from provider
  content?: string;  // longer raw content if requested
  score?: number;    // provider relevance score
}

export interface WebSearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<SearchResult[]>;
}

export class WebSearchError extends Error {
  override readonly name = 'WebSearchError';
  readonly status: number | undefined;  // for extractApiErrorMeta compatibility in consumer

  constructor(
    message: string,
    public readonly options: {
      provider: string;
      query: string;
      statusCode?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.status = options.statusCode;
  }
}
