import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type Message,
  type ContentBlock,
  type Tool,
  type ToolConfiguration,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import type { ModelClient, ModelCompleteParams, ModelCompleteResult, AnthropicTool } from './types.js';

const MAX_TOOL_TURNS    = 20;
const THROTTLE_RETRIES  = 3;
const THROTTLE_BASE_DELAY = 1_000; // 1s, doubles each attempt
const DEFAULT_TIMEOUT_MS  = 90_000;

function isThrottlingError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'ThrottlingException' || code === 429;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        inferenceConfig: { maxTokens: params.maxTokens ?? 4096 },
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

      console.info(
        `[bedrock] turn=${turnsUsed} model=${params.model} ` +
        `inputTokens=${turnInput} outputTokens=${turnOutput} stopReason=${finalStopReason}`,
      );

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
        const summariseCommand = new ConverseCommand({
          modelId: params.model,
          messages,
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
          `inputTokens=${summariseResponse.usage?.inputTokens} outputTokens=${summariseResponse.usage?.outputTokens}`,
        );
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
}
