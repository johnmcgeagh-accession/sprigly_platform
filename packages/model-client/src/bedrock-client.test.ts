import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockCtor = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn((config: unknown) => { mockCtor(config); return { send: mockSend }; }),
  ConverseCommand: vi.fn((input: unknown) => ({ input })),
  ConverseStreamCommand: vi.fn((input: unknown) => ({ input })),
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
    mockCtor.mockClear();
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

/**
 * ── THE CLOCKS ───────────────────────────────────────────────────────────────────────
 *
 * `sendWithRetry` has bounded every non-streaming call since it was written. `sendStreamWithRetry`
 * bounded nothing: it awaited `client.send` with no abortSignal, and STREAM_IDLE_MS guards only
 * the chunks that arrive AFTER the stream exists. So a send that never returned a stream waited
 * forever, and so did every caller of completeStreaming — the month generation call, lean-line,
 * voice-batch-merge. None of the streaming path had a test at all.
 */
describe('request clocks', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockCtor.mockClear();
  });

  /**
   * A send that never settles on its own and rejects when the signal aborts — which is what the
   * AWS SDK does, and what `sendUnderClock` depends on. Written the naive way first (a promise
   * that simply never settles) and every timeout test hung: firing the AbortController is not by
   * itself an outcome, something has to reject. That dependency is worth having in the fixture
   * rather than discovering it against a real hung socket.
   */
  const hangingSend = () => (_cmd: unknown, opts?: { abortSignal?: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      opts?.abortSignal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })));
    });

  it('sets a socket connect timeout on the client, and no requestTimeout', () => {
    // requestTimeout is a socket-IDLE timeout, and for a non-streaming Converse the socket is
    // idle for the whole generation — setting it low enough to be useful would cut off a
    // legitimately slow completion. Asserted as an ABSENCE so a future "hardening" pass that
    // adds one has to come here and read why it was left out.
    new BedrockClient();
    const config = mockCtor.mock.calls[0]?.[0] as { requestHandler?: Record<string, unknown> };
    expect(config.requestHandler).toEqual({ connectionTimeout: 10_000 });
    expect(config.requestHandler).not.toHaveProperty('requestTimeout');
  });

  it('a stream that never opens fails instead of hanging', async () => {
    vi.useFakeTimers();
    try {
      mockSend.mockImplementation(hangingSend());
      const promise = new BedrockClient().completeStreaming(BASE_PARAMS);
      const assertion = expect(promise).rejects.toThrow(/stream timed out after 60s opening/);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes an abort signal on the streaming path', async () => {
    mockSend.mockResolvedValue({ stream: (async function* () { /* empty */ })() });
    await new BedrockClient().completeStreaming(BASE_PARAMS);
    expect(mockSend).toHaveBeenCalledWith(expect.anything(), { abortSignal: expect.anything() });
  });

  it('CLEARS the open-timer once the stream is returned, so a long generation is not aborted', async () => {
    // The load-bearing one. The signal stays attached to the in-flight request, so a timer left
    // armed would abort a perfectly healthy stream the moment it passed 60s — turning a fix for
    // a hang into a cap on generation length. Chunks 25s apart (under STREAM_IDLE_MS) carry the
    // stream to 75s of wall clock, well past the open timeout.
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      mockSend.mockImplementation((_cmd: unknown, opts: { abortSignal: AbortSignal }) => {
        signal = opts.abortSignal;
        return Promise.resolve({
          stream: (async function* () {
            for (const text of ['early', ' mid', ' and', ' late']) {
              yield { contentBlockDelta: { delta: { text } } };
              await vi.advanceTimersByTimeAsync(25_000);
            }
          })(),
        });
      });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      const result = await new BedrockClient().completeStreaming(BASE_PARAMS);
      info.mockRestore();
      expect(result.content).toBe('early mid and late');
      expect(signal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the non-streaming clock still reports a timeout as one', async () => {
    vi.useFakeTimers();
    try {
      mockSend.mockImplementation(hangingSend());
      const promise = new BedrockClient().complete(BASE_PARAMS);
      const assertion = expect(promise).rejects.toThrow(/Bedrock request timed out after 180s for model/);
      await vi.advanceTimersByTimeAsync(180_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a timeout message says "timed out", which is what classes it TRANSIENT downstream', async () => {
    // Not cosmetic: classifyGenerationFailure (ai-change-cap.ts) matches that substring to decide
    // the generation sweep should retry. An unrecognised message falls to `deterministic` and the
    // post is stranded for an operator instead of being retried.
    vi.useFakeTimers();
    try {
      mockSend.mockImplementation(hangingSend());
      const promise = new BedrockClient().completeStreaming(BASE_PARAMS);
      const assertion = promise.catch((e: Error) => e.message.toLowerCase());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await assertion).toContain('timed out');
    } finally {
      vi.useRealTimers();
    }
  });
});
