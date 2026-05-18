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
  return { output: { message: { role: 'assistant', content } }, stopReason, usage };
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
    mockSend.mockResolvedValue(makeResponse([
      { toolUse: { toolUseId: 'tu_1', name: 'web_search', input: { query: 'test' } } },
      { text: 'Based on my search...' },
    ]));
    const result = await new BedrockClient().complete(BASE_PARAMS);
    expect(result.content).toBe('Based on my search...');
  });

  it('loops on tool_use and returns final text after end_turn', async () => {
    mockSend
      .mockResolvedValueOnce(makeResponse(
        [{ toolUse: { toolUseId: 'tu_1', name: 'web_search', input: {} } }],
        'tool_use',
        { inputTokens: 100, outputTokens: 20 },
      ))
      .mockResolvedValueOnce(makeResponse(
        [{ text: 'Research complete.' }],
        'end_turn',
        { inputTokens: 200, outputTokens: 80 },
      ));

    const result = await new BedrockClient().complete(BASE_PARAMS);
    expect(result.content).toBe('Research complete.');
    expect(result.stopReason).toBe('end_turn');
    expect(result.inputTokens).toBe(300);   // 100 + 200
    expect(result.outputTokens).toBe(100);  // 20 + 80
    expect(result.toolTurns).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('sends empty toolResult blocks after server-side tool use', async () => {
    mockSend
      .mockResolvedValueOnce(makeResponse(
        [{ toolUse: { toolUseId: 'tu_abc', name: 'web_search', input: {} } }],
        'tool_use',
      ))
      .mockResolvedValueOnce(makeResponse([{ text: 'done' }]));

    await new BedrockClient().complete(BASE_PARAMS);

    const secondCall = vi.mocked(ConverseCommand).mock.calls[1]?.[0] as {
      messages?: Array<{ role: string; content: unknown[] }>;
    };
    const userTurn = secondCall?.messages?.at(-1);
    expect(userTurn?.role).toBe('user');
    const content = userTurn?.content as Array<{ toolResult?: { toolUseId: string; content: unknown[] } }>;
    expect(content[0]?.toolResult?.toolUseId).toBe('tu_abc');
    expect(content[0]?.toolResult?.content).toEqual([{ text: '' }]);
  });

  it('accumulates tokens across 3 tool turns', async () => {
    mockSend
      .mockResolvedValueOnce(makeResponse([{ toolUse: { toolUseId: 'tu_1', name: 'web_search', input: {} } }], 'tool_use', { inputTokens: 10, outputTokens: 5 }))
      .mockResolvedValueOnce(makeResponse([{ toolUse: { toolUseId: 'tu_2', name: 'web_search', input: {} } }], 'tool_use', { inputTokens: 15, outputTokens: 8 }))
      .mockResolvedValueOnce(makeResponse([{ text: 'Final answer.' }], 'end_turn', { inputTokens: 20, outputTokens: 30 }));

    const result = await new BedrockClient().complete(BASE_PARAMS);
    expect(result.inputTokens).toBe(45);
    expect(result.outputTokens).toBe(43);
    expect(result.toolTurns).toBe(3);
  });

  it('does not set toolTurns when no tool use occurs', async () => {
    mockSend.mockResolvedValue(makeResponse([{ text: 'Direct answer.' }]));
    const result = await new BedrockClient().complete(BASE_PARAMS);
    expect(result.toolTurns).toBeUndefined();
  });

  it('runs a forced summarise turn when MAX_TOOL_TURNS is reached', async () => {
    const toolUseResponse = makeResponse(
      [{ toolUse: { toolUseId: 'tu_x', name: 'web_search', input: {} } }],
      'tool_use',
    );
    const summariseResponse = makeResponse([{ text: 'Here is the research summary.' }], 'end_turn', { inputTokens: 500, outputTokens: 300 });
    // First 20 calls return tool_use; the 21st is the forced summarise call.
    mockSend.mockResolvedValue(toolUseResponse);
    mockSend.mockResolvedValueOnce(summariseResponse);  // last call returns summary
    // Re-queue: 19 tool_use calls then the summary
    mockSend.mockReset();
    for (let i = 0; i < 20; i++) mockSend.mockResolvedValueOnce(toolUseResponse);
    mockSend.mockResolvedValueOnce(summariseResponse);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await new BedrockClient().complete({
      ...BASE_PARAMS,
      toolHandlers: { web_search: async () => ({ results: 'some results' }) },
    });
    expect(result.content).toBe('Here is the research summary.');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('max tool turns'));

    // 21 total ConverseCommand calls: 20 tool turns + 1 summarise.
    const calls = vi.mocked(ConverseCommand).mock.calls;
    expect(calls).toHaveLength(21);

    const summariseInput = calls[calls.length - 1]?.[0] as unknown as Record<string, unknown>;
    // No toolConfig on the summarise call.
    expect(summariseInput['toolConfig']).toBeUndefined();

    // No toolUse or toolResult blocks in the messages passed to the summarise call.
    type MsgShape = { role: string; content: Record<string, unknown>[] };
    const summariseMessages = summariseInput['messages'] as MsgShape[];
    for (const msg of summariseMessages) {
      for (const block of msg.content) {
        expect('toolUse' in block).toBe(false);
        expect('toolResult' in block).toBe(false);
      }
    }

    warn.mockRestore();
  });

  it('maps tools with input_schema to Bedrock toolSpec format', async () => {
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

  it('uses empty object schema for built-in tools with no input_schema', async () => {
    mockSend.mockResolvedValue(makeResponse([{ text: 'ok' }]));
    await new BedrockClient().complete({
      ...BASE_PARAMS,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: {
          tools: [{
            toolSpec: {
              name: 'web_search',
              inputSchema: { json: { type: 'object', properties: {} } },
            },
          }],
        },
      }),
    );
  });

  it('retries on ThrottlingException and succeeds on second attempt', async () => {
    const throttleErr = Object.assign(new Error('Throttled'), {
      name: 'ThrottlingException',
    });
    mockSend
      .mockRejectedValueOnce(throttleErr)
      .mockResolvedValueOnce(makeResponse([{ text: 'ok after retry' }]));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await new BedrockClient().complete(BASE_PARAMS);
    expect(result.content).toBe('ok after retry');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ThrottlingException'));
    warn.mockRestore();
  });
});
