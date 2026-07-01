import { describe, it, expect, vi } from 'vitest';
import { handleWebSearchTool, formatSearchResultsForModel } from './tool-handler.js';
import { WebSearchError } from './types.js';
import type { WebSearchProvider, SearchResult } from './types.js';

const RESULT: SearchResult = {
  title:   'Test Corp',
  url:     'https://test.example.com',
  snippet: 'A test company.',
  score:   0.8,
};

describe('formatSearchResultsForModel', () => {
  it('formats results as titled blocks separated by ---', () => {
    const output = formatSearchResultsForModel([RESULT]);
    expect(output).toContain('**Test Corp**');
    expect(output).toContain('https://test.example.com');
    expect(output).toContain('A test company.');
  });

  it('joins multiple results with ---', () => {
    const second: SearchResult = { title: 'Other', url: 'https://other.com', snippet: 'Other snippet.' };
    const output = formatSearchResultsForModel([RESULT, second]);
    expect(output).toContain('---');
    expect(output).toContain('**Test Corp**');
    expect(output).toContain('**Other**');
  });
});

describe('handleWebSearchTool', () => {
  it('returns (no results) string when provider returns empty array', async () => {
    const provider: WebSearchProvider = { search: vi.fn().mockResolvedValue([]) };
    const result = await handleWebSearchTool(provider, 'empty');
    expect(result).toEqual({ results: '(no results)' });
  });

  it('returns formatted results when provider returns results', async () => {
    const provider: WebSearchProvider = { search: vi.fn().mockResolvedValue([RESULT]) };
    const result = await handleWebSearchTool(provider, 'test');
    expect(result.results).toContain('Test Corp');
    expect(result.results).toContain('https://test.example.com');
  });

  it('propagates WebSearchError without catching', async () => {
    const err = new WebSearchError('Search failed', { provider: 'tavily', query: 'test' });
    const provider: WebSearchProvider = { search: vi.fn().mockRejectedValue(err) };
    await expect(handleWebSearchTool(provider, 'test')).rejects.toBeInstanceOf(WebSearchError);
  });

  it('passes query to provider.search', async () => {
    const mockSearch = vi.fn().mockResolvedValue([]);
    const provider: WebSearchProvider = { search: mockSearch };
    await handleWebSearchTool(provider, 'specific query');
    expect(mockSearch).toHaveBeenCalledWith('specific query');
  });
});
