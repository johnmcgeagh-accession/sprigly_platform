import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseCommandOutput,
  type ConverseStreamOutput,
  type Message,
  type ContentBlock,
  type Tool,
  type ToolConfiguration,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import type { ModelClient, ModelCompleteParams, ModelCompleteResult, AnthropicTool } from './types.js';

const MAX_TOOL_TURNS      = 20;
const THROTTLE_RETRIES    = 3;
const THROTTLE_BASE_DELAY = 1_000; // 1s, doubles each attempt
const DEFAULT_TIMEOUT_MS  = 180_000;
const STREAM_IDLE_MS      = 30_000; // abort stream if no chunk arrives for 30s

function isThrottlingError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'ThrottlingException' || code === 429;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps an AsyncIterable and rejects if no item arrives within idleMs.
// Uses explicit iter.next() + Promise.race so a mid-stream stall cannot hold the
// call open indefinitely — the watchdog fires exactly once per idle window,
// calls iter.return() to signal the underlying stream, and rethrows.
async function* idleTimeoutIterator<T>(
  iterable: AsyncIterable<T>,
  idleMs: number,
): AsyncGenerator<T> {
  const iter = iterable[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    while (true) {
      const next = await Promise.race([
        iter.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Bedrock stream stalled: no chunk for ${idleMs / 1000}s`)),
            idleMs,
          );
        }),
      ]);
      clearTimeout(timer); // chunk arrived — cancel the pending watchdog
      if (next.done) break;
      yield next.value;
    }
  } catch (err) {
    await iter.return?.(); // signal to the underlying stream that we are done
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function buildToolConfig(tools?: unknown[]): ToolConfiguration | undefined {
  if (tools === undefined || tools.length === 0) return undefined;
  return {
    tools: tools.map((t): Tool => {
      const tool = t as AnthropicTool;
      return {
        toolSpec: {
          name: tool.name,
          ...(tool.description !== undefined && { description: tool.description }),
          // Built-in Anthropic tools (e.g. web_search_20250305) have no input_schema.
          // Provide a valid empty object schema so Bedrock accepts the tool config.
          inputSchema: {
            json: tool.input_schema ?? { type: 'object', properties: {} },
          } as ToolInputSchema,
        },
      };
    }),
  };
}

export class BedrockClient implements ModelClient {
  private client: BedrockRuntimeClient;
  private timeoutMs: number;

  constructor(
    region = 'eu-west-2',
    credentials?: { accessKeyId: string; secretAccessKey: string },
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.client = new BedrockRuntimeClient({
      region,
      ...(credentials !== undefined && { credentials }),
    });
    this.timeoutMs = timeoutMs;
  }

  // Retry wraps only stream initiation — ThrottlingException (HTTP 429) manifests
  // before any bytes arrive, so retrying is safe. Mid-stream errors cannot be retried.
  private async sendStreamWithRetry(
    command: ConverseStreamCommand,
  ): Promise<AsyncIterable<ConverseStreamOutput>> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= THROTTLE_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = THROTTLE_BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(`[bedrock] ThrottlingException (stream) — retrying in ${delay}ms (attempt ${attempt}/${THROTTLE_RETRIES})`);
        await sleep(delay);
      }
      try {
        const response = await this.client.send(command);
        if (!response.stream) throw new Error('Bedrock stream was undefined');
        return response.stream;
      } catch (err) {
        if (isThrottlingError(err) && attempt < THROTTLE_RETRIES) { lastErr = err; continue; }
        throw err;
      }
    }
    throw lastErr;
  }

  private async sendWithRetry(command: ConverseCommand): Promise<ConverseCommandOutput> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= THROTTLE_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = THROTTLE_BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(`[bedrock] ThrottlingException — retrying in ${delay}ms (attempt ${attempt}/${THROTTLE_RETRIES})`);
        await sleep(delay);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const result = await this.client.send(command, { abortSignal: controller.signal });
        clearTimeout(timer);
        return result;
      } catch (err) {
        clearTimeout(timer);
        if ((controller.signal as AbortSignal & { reason?: unknown }).reason !== undefined ||
            (err as { name?: string }).name === 'AbortError') {
          throw new Error(
            `Bedrock request timed out after ${this.timeoutMs / 1000}s for model ${command.input?.modelId}`,
          );
        }
        if (isThrottlingError(err) && attempt < THROTTLE_RETRIES) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  async complete(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    const messages: Message[] = params.messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }] as ContentBlock[],
    }));

    const toolConfig = buildToolConfig(params.tools);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = '';
    let finalStopReason = 'end_turn';
    let turnsUsed = 0;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      turnsUsed = turn + 1;

      const command = new ConverseCommand({
        modelId: params.model,
        messages,
        ...(params.system !== undefined && { system: [{ text: params.system }] }),
        ...(toolConfig !== undefined && { toolConfig }),
        inferenceConfig: {
          maxTokens: params.maxTokens ?? 4096,
          ...(params.temperature !== undefined && { temperature: params.temperature }),
        },
      });

      const response = await this.sendWithRetry(command);

      const turnInput  = response.usage?.inputTokens  ?? 0;
      const turnOutput = response.usage?.outputTokens ?? 0;
      totalInputTokens  += turnInput;
      totalOutputTokens += turnOutput;
      finalStopReason = response.stopReason ?? 'end_turn';

      const content = response.output?.message?.content ?? [];
      const textBlock = content.find((c) => c.text !== undefined);
      if (textBlock?.text) finalText = textBlock.text;

      const turnText = textBlock?.text ?? '';
      console.info(
        `[bedrock] turn=${turnsUsed} model=${params.model} ` +
        `inputTokens=${turnInput} outputTokens=${turnOutput} stopReason=${finalStopReason} ` +
        `contentLength=${turnText.length}`,
      );
      if (turnText.length > 0) {
        console.info(`[bedrock] turn=${turnsUsed} contentHead=${JSON.stringify(turnText.slice(0, 1000))}`);
        if (turnText.length > 1000) {
          console.info(`[bedrock] turn=${turnsUsed} contentTail=${JSON.stringify(turnText.slice(-1000))}`);
        }
      }

      if (finalStopReason !== 'tool_use') break;

      if (turn === MAX_TOOL_TURNS - 1) {
        console.warn(
          `[bedrock] max tool turns (${MAX_TOOL_TURNS}) reached for model=${params.model}. ` +
          `Forcing summarise turn. inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens}`,
        );
        // Append the last assistant turn so the model has full context.
        if (response.output?.message !== undefined) {
          messages.push(response.output.message);
        }
        messages.push({
          role: 'user',
          content: [{ text: 'You have reached the search limit. Please now write up all the research you have gathered into a comprehensive summary.' }],
        });
        // Bedrock rejects a request without toolConfig when the message history
        // contains toolUse or toolResult blocks. Keep only text blocks across
        // all messages, then drop any message that becomes empty.
        const summariseMessages = messages
          .map((m) => ({ ...m, content: (m.content ?? []).filter((c) => 'text' in c) }))
          .filter((m) => m.content.length > 0);
        const summariseCommand = new ConverseCommand({
          modelId: params.model,
          messages: summariseMessages,
          ...(params.system !== undefined && { system: [{ text: params.system }] }),
          // No toolConfig — force a text response.
          inferenceConfig: { maxTokens: params.maxTokens ?? 4096 },
        });
        const summariseResponse = await this.sendWithRetry(summariseCommand);
        totalInputTokens  += summariseResponse.usage?.inputTokens  ?? 0;
        totalOutputTokens += summariseResponse.usage?.outputTokens ?? 0;
        const summariseContent = summariseResponse.output?.message?.content ?? [];
        const summariseText = summariseContent.find((c) => c.text !== undefined)?.text ?? '';
        if (summariseText) finalText = summariseText;
        console.info(
          `[bedrock] summarise turn model=${params.model} ` +
          `inputTokens=${summariseResponse.usage?.inputTokens} outputTokens=${summariseResponse.usage?.outputTokens} ` +
          `contentLength=${summariseText.length}`,
        );
        if (summariseText.length > 0) {
          console.info(`[bedrock] summarise contentHead=${JSON.stringify(summariseText.slice(0, 1000))}`);
          if (summariseText.length > 1000) {
            console.info(`[bedrock] summarise contentTail=${JSON.stringify(summariseText.slice(-1000))}`);
          }
        }
        break;
      }

      // Append assistant turn to conversation history.
      if (response.output?.message !== undefined) {
        messages.push(response.output.message);
      }

      const toolUseBlocks = content.filter((c) => c.toolUse !== undefined);
      const toolResultContent: ContentBlock[] = await Promise.all(
        toolUseBlocks.map(async (c) => {
          const toolUse = c.toolUse!;
          const handler = params.toolHandlers?.[toolUse.name ?? ''];
          let resultText = '';
          if (handler !== undefined) {
            try {
              const result = await handler(toolUse.input ?? {});
              resultText = typeof result === 'string' ? result : JSON.stringify(result);
            } catch (err) {
              console.warn(`[bedrock] tool handler "${toolUse.name}" failed:`, err);
              throw err;
            }
          }
          return {
            toolResult: {
              toolUseId: toolUse.toolUseId ?? '',
              content: [{ text: resultText }],
            },
          };
        }),
      );
      messages.push({ role: 'user', content: toolResultContent });
    }

    return {
      content: finalText,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      modelId: params.model,
      stopReason: finalStopReason,
      ...(turnsUsed > 1 && { toolTurns: turnsUsed }),
    };
  }

  async completeStreaming(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    const command = new ConverseStreamCommand({
      modelId: params.model,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: [{ text: m.content }],
      })),
      ...(params.system !== undefined && { system: [{ text: params.system }] }),
      inferenceConfig: { maxTokens: params.maxTokens ?? 4096 },
    });

    const rawStream = await this.sendStreamWithRetry(command);
    const stream    = idleTimeoutIterator(rawStream, STREAM_IDLE_MS);

    let text = '', inputTokens = 0, outputTokens = 0, stopReason = 'end_turn';

    for await (const event of stream) {
      if (event.contentBlockDelta?.delta?.text) text += event.contentBlockDelta.delta.text;
      if (event.messageStop?.stopReason)         stopReason = event.messageStop.stopReason;
      if (event.metadata?.usage) {
        inputTokens  = event.metadata.usage.inputTokens  ?? 0;
        outputTokens = event.metadata.usage.outputTokens ?? 0;
      }
    }

    console.info(
      `[bedrock] stream model=${params.model} inputTokens=${inputTokens} ` +
      `outputTokens=${outputTokens} stopReason=${stopReason} contentLength=${text.length}`,
    );
    return { content: text, inputTokens, outputTokens, modelId: params.model, stopReason };
  }
}
