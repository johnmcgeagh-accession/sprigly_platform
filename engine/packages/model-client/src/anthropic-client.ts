import Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, ModelCompleteParams, ModelCompleteResult } from './types.js';

export class AnthropicClient implements ModelClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: params.messages,
      ...(params.system !== undefined && { system: params.system }),
      ...(params.tools !== undefined && {
        tools: params.tools as Anthropic.Tool[],
      }),
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const content = textBlock?.type === 'text' ? textBlock.text : '';

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      modelId: params.model,
      stopReason: response.stop_reason ?? 'end_turn',
    };
  }
}
