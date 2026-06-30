import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: mockCreate } })),
}));

import { AnthropicClient } from './anthropic-client.js';

const BASE_PARAMS = {
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user' as const, content: 'Hello' }],
};

function makeResponse(
  content: Array<Record<string, unknown>>,
  stopReason = 'end_turn',
  usage = { input_tokens: 10, output_tokens: 5 },
) {
  return { content, stop_reason: stopReason, usage };
}

describe('AnthropicClient', () => {
  beforeEach(() => mockCreate.mockReset());

  it('returns text content for a single-turn response', async () => {
    mockCreate.mockResolvedValue(makeResponse([{ type: 'text', text: 'Hello world' }]));
    const result = await new AnthropicClient('key').complete(BASE_PARAMS);
    expect(result.content).toBe('Hello world');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.toolTurns).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('loops on tool_use and returns final text', async () => {
    mockCreate
      .mockResolvedValueOnce(makeResponse(
        [{ type: 'tool_use', id: 'tu_1', name: 'web_search', input: { query: 'test' } }],
        'tool_use',
        { input_tokens: 20, output_tokens: 10 },
      ))
      .mockResolvedValueOnce(makeResponse(
        [{ type: 'text', text: 'Final answer after search.' }],
        'end_turn',
        { input_tokens: 30, output_tokens: 15 },
      ));

    const result = await new AnthropicClient('key').complete({
      ...BASE_PARAMS,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('Final answer after search.');
    expect(result.inputTokens).toBe(50);   // 20 + 30 accumulated
    expect(result.outputTokens).toBe(25);  // 10 + 15 accumulated
    expect(result.toolTurns).toBe(2);
  });

  it('accumulates token counts across multiple tool turns', async () => {
    mockCreate
      .mockResolvedValueOnce(makeResponse(
        [{ type: 'tool_use', id: 'tu_1', name: 'web_search', input: {} }],
        'tool_use', { input_tokens: 10, output_tokens: 5 },
      ))
      .mockResolvedValueOnce(makeResponse(
        [{ type: 'tool_use', id: 'tu_2', name: 'web_search', input: {} }],
        'tool_use', { input_tokens: 15, output_tokens: 8 },
      ))
      .mockResolvedValueOnce(makeResponse(
        [{ type: 'text', text: 'Done.' }],
        'end_turn', { input_tokens: 20, output_tokens: 10 },
      ));

    const result = await new AnthropicClient('key').complete({
      ...BASE_PARAMS,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });

    expect(result.inputTokens).toBe(45);   // 10 + 15 + 20
    expect(result.outputTokens).toBe(23);  // 5 + 8 + 10
    expect(result.toolTurns).toBe(3);
  });

  it('at max turns returns accumulated content and does not throw', async () => {
    // Every call returns tool_use — simulates a runaway tool loop
    mockCreate.mockResolvedValue(makeResponse(
      [{ type: 'tool_use', id: 'tu_1', name: 'web_search', input: {} }],
      'tool_use', { input_tokens: 5, output_tokens: 2 },
    ));

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await new AnthropicClient('key').complete({
      ...BASE_PARAMS,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });
    consoleSpy.mockRestore();

    // Must not throw; content is empty (model never produced text) but that's acceptable
    expect(result.content).toBe('');
    expect(result.toolTurns).toBe(20);
    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it('emits a console.warn at max turns', async () => {
    mockCreate.mockResolvedValue(makeResponse(
      [{ type: 'tool_use', id: 'tu_1', name: 'web_search', input: {} }],
      'tool_use',
    ));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await new AnthropicClient('key').complete({
      ...BASE_PARAMS,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });

    // Assert before restore — mockRestore() clears the call history.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/max tool turns/i);
    warn.mockRestore();
  });

  it('does not set toolTurns for a single non-tool call', async () => {
    mockCreate.mockResolvedValue(makeResponse([{ type: 'text', text: 'Simple response.' }]));
    const result = await new AnthropicClient('key').complete(BASE_PARAMS);
    expect(result.toolTurns).toBeUndefined();
  });
});
