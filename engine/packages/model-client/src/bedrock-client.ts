import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type Tool,
  type ToolConfiguration,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime';
import type { ModelClient, ModelCompleteParams, ModelCompleteResult, AnthropicTool } from './types.js';

const THROTTLE_RETRIES     = 3;
const THROTTLE_BASE_DELAY  = 1_000; // 1s, doubles each attempt
const DEFAULT_TIMEOUT_MS   = 90_000;

function isThrottlingError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'ThrottlingException' || code === 429;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  async complete(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    const messages: Message[] = params.messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));

    const toolConfig: ToolConfiguration | undefined =
      params.tools !== undefined
        ? {
            tools: params.tools.map(
              (t): Tool => {
                const tool = t as AnthropicTool;
                return {
                  toolSpec: {
                    name: tool.name,
                    description: tool.description,
                    inputSchema: { json: tool.input_schema } as ToolInputSchema,
                  },
                };
              },
            ),
          }
        : undefined;

    const command = new ConverseCommand({
      modelId: params.model,
      messages,
      ...(params.system !== undefined && {
        system: [{ text: params.system }],
      }),
      ...(toolConfig !== undefined && { toolConfig }),
      inferenceConfig: { maxTokens: params.maxTokens ?? 4096 },
    });

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
        const response = await this.client.send(command, { abortSignal: controller.signal });
        clearTimeout(timer);

        const textContent = response.output?.message?.content?.find(
          (c) => c.text !== undefined,
        );
        const content = textContent?.text ?? '';

        return {
          content,
          inputTokens:  response.usage?.inputTokens  ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
          modelId:      params.model,
          stopReason:   response.stopReason ?? 'end_turn',
        };
      } catch (err) {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          throw new Error(
            `Bedrock request timed out after ${this.timeoutMs / 1000}s for model ${params.model}`,
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
}
