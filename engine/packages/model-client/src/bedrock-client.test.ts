import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: mockSend })),
  ConverseCommand: vi.fn((input: unknown) => ({ input })),
}));

import { BedrockClient } from './bedrock-client.js';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const BASE_PARAMS = {
  model: 'eu.anthropic.claude-haiku-3-5-20251001-v1:0',
  messages: [{ role: 'user' as const, content: 'Hello' }],
};

function makeResponse(
  content: Record<string, unknown>[],
  stopReason = 'end_turn',
  usage = { inputTokens: 10, outputTokens: 5 },
) {
  return { output: { message: { content } }, stopReason, usage };
}

describe('BedrockClient', () => {
  beforeEach(() => {
    mockSend.mockReset();
    vi.mocked(ConverseCommand).mockClear();
  });

  it('extracts text from a plain text response', async () => {
    mockSend.mockResolvedValue(makeResponse([{ text: 'Hello world' }]));
    const result = await new BedrockClient().complete(BASE_PARAMS);
    expect(result.content).toBe('Hello world');
    expect(result.stopReason).toBe('end_turn');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.modelId).toBe(BASE_PARAMS.model);
  });

  it('extracts text when a toolUse block precedes the text block', async () => {
    // Verifies .find(c => c.text !== undefined) skips toolUse and finds the text block
    mockSend.mockResolvedValue(makeResponse([
      { toolUse: { toolUseId: 'tu_1', name: 'web_search', input: { query: 'test' } } },
      { text: 'Based on my search...' },
    ]));
    const result = await new BedrockClient().complete(BASE_PARAMS);
    expect(result.content).toBe('Based on my search...');
  });

  it('returns empty string and stopReason=tool_use when only a toolUse block is returned', async () => {
    mockSend.mockResolvedValue(makeResponse(
      [{ toolUse: { toolUseId: 'tu_1', name: 'web_search', input: { query: 'test' } } }],
      'tool_use',
    ));
    const result = await new BedrockClient().complete(BASE_PARAMS);
    expect(result.content).toBe('');
    expect(result.stopReason).toBe('tool_use');
  });

  it('maps AnthropicTool shape to Bedrock toolSpec format', async () => {
    mockSend.mockResolvedValue(makeResponse([{ text: 'ok' }]));
    await new BedrockClient().complete({
      ...BASE_PARAMS,
      tools: [{
        name: 'web_search',
        description: 'Search the web',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      }],
    });
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: {
          tools: [{
            toolSpec: {
              name: 'web_search',
              description: 'Search the web',
              inputSchema: {
                json: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                },
              },
            },
          }],
        },
      }),
    );
  });
});
