import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TavilyProvider } from './tavily-provider.js';
import { WebSearchError } from './types.js';

// ── Module mock ───────────────────────────────────────────────────────────────

const { mockTavilySearch } = vi.hoisted(() => ({
  mockTavilySearch: vi.fn(),
}));

vi.mock('@tavily/core', () => ({
  tavily: vi.fn().mockReturnValue({ search: mockTavilySearch }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const RESULT = {
  title: 'Acme Corp',
  url: 'https://acme.example.com',
  content: 'A leading widget manufacturer.',
  score: 0.92,
  publishedDate: '',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TavilyProvider', () => {
  beforeEach(() => {
    process.env['TAVILY_API_KEY'] = 'test-key';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env['TAVILY_API_KEY'];
  });

  it('throws at construction if TAVILY_API_KEY is not set', () => {
    delete process.env['TAVILY_API_KEY'];
    expect(() => new TavilyProvider()).toThrow('TAVILY_API_KEY');
  });

  it('maps Tavily results to SearchResult[] with snippet', async () => {
    mockTavilySearch.mockResolvedValueOnce({ results: [RESULT] });
    const provider = new TavilyProvider();
    const results = await provider.search('test query');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title:   'Acme Corp',
      url:     'https://acme.example.com',
      snippet: 'A leading widget manufacturer.',
      score:   0.92,
    });
  });

  it('returns empty array (not a throw) when results array is empty', async () => {
    mockTavilySearch.mockResolvedValueOnce({ results: [] });
    const provider = new TavilyProvider();
    await expect(provider.search('no results query')).resolves.toEqual([]);
  });

  it('throws WebSearchError before calling Tavily when query contains site: operator', async () => {
    const provider = new TavilyProvider();
    await expect(provider.search('site:example.com')).rejects.toBeInstanceOf(WebSearchError);
    expect(mockTavilySearch).not.toHaveBeenCalled();
  });

  it.each([
    'site:linkedin.com Sally McLaren',
    'intitle:Ivy founder',
    'inurl:about-us',
    'filetype:pdf annual report',
    '"Ivy clothing" founder',
    'Ivy clothing -fashion',
    'Ivy OR fashion brand',
  ])('rejects operator query: %s', async (query) => {
    const provider = new TavilyProvider();
    await expect(provider.search(query)).rejects.toBeInstanceOf(WebSearchError);
    expect(mockTavilySearch).not.toHaveBeenCalled();
  });

  it('does not reject clean natural language queries', async () => {
    mockTavilySearch.mockResolvedValue({ results: [] });
    const provider = new TavilyProvider();
    await expect(provider.search('Ivy clothing Oxford founder')).resolves.toBeDefined();
  });

  it('throws WebSearchError on HTTP 503', async () => {
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockTavilySearch.mockRejectedValueOnce(err);
    const provider = new TavilyProvider();
    await expect(provider.search('fail query')).rejects.toBeInstanceOf(WebSearchError);
  });

  it('WebSearchError carries provider, query, and statusCode', async () => {
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockTavilySearch.mockRejectedValueOnce(err);
    const provider = new TavilyProvider();
    let thrown: unknown;
    try {
      await provider.search('diagnostic query');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WebSearchError);
    const wsErr = thrown as WebSearchError;
    expect(wsErr.options.provider).toBe('tavily');
    expect(wsErr.options.query).toBe('diagnostic query');
    expect(wsErr.options.statusCode).toBe(503);
    // top-level status property for extractApiErrorMeta compatibility
    expect(wsErr.status).toBe(503);
  });

  it('throws WebSearchError on network failure (DNS/connection error)', async () => {
    mockTavilySearch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const provider = new TavilyProvider();
    await expect(provider.search('network fail')).rejects.toBeInstanceOf(WebSearchError);
  });

  it('WebSearchError on network failure has undefined statusCode', async () => {
    mockTavilySearch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const provider = new TavilyProvider();
    let thrown: unknown;
    try {
      await provider.search('network fail');
    } catch (e) {
      thrown = e;
    }
    const wsErr = thrown as WebSearchError;
    expect(wsErr.options.statusCode).toBeUndefined();
  });

  it('forwards maxResults and searchDepth options to Tavily', async () => {
    mockTavilySearch.mockResolvedValueOnce({ results: [] });
    const provider = new TavilyProvider();
    await provider.search('test', { maxResults: 10, searchDepth: 'advanced' });
    expect(mockTavilySearch).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ maxResults: 10, searchDepth: 'advanced' }),
    );
  });

  it('forwards includeDomains and excludeDomains options to Tavily', async () => {
    mockTavilySearch.mockResolvedValueOnce({ results: [] });
    const provider = new TavilyProvider();
    await provider.search('test', {
      includeDomains: ['example.com'],
      excludeDomains: ['spam.com'],
    });
    expect(mockTavilySearch).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({
        includeDomains: ['example.com'],
        excludeDomains: ['spam.com'],
      }),
    );
  });

  it('includes rawContent as content when provider returns it', async () => {
    mockTavilySearch.mockResolvedValueOnce({
      results: [{ ...RESULT, rawContent: 'Full page text here.' }],
    });
    const provider = new TavilyProvider();
    const results = await provider.search('test');
    expect(results[0]?.content).toBe('Full page text here.');
  });

  it('omits content field when rawContent is absent', async () => {
    mockTavilySearch.mockResolvedValueOnce({ results: [RESULT] });
    const provider = new TavilyProvider();
    const results = await provider.search('test');
    expect(Object.prototype.hasOwnProperty.call(results[0], 'content')).toBe(false);
  });
});
