import Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, ModelCompleteParams, ModelCompleteResult } from './types.js';

const MAX_TOOL_TURNS = 20;

export class AnthropicClient implements ModelClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    const messages: Anthropic.MessageParam[] = params.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = '';
    let finalStopReason = 'end_turn';
    let turnsUsed = 0;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      turnsUsed = turn + 1;
      const response = await this.client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages,
        ...(params.system !== undefined && { system: params.system }),
        ...(params.tools !== undefined && { tools: params.tools as Anthropic.Tool[] }),
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      finalStopReason = response.stop_reason ?? 'end_turn';

      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock?.type === 'text') finalText = textBlock.text;

      if (response.stop_reason !== 'tool_use') break;

      if (turn === MAX_TOOL_TURNS - 1) {
        console.warn(
          `[AnthropicClient] max tool turns (${MAX_TOOL_TURNS}) reached for model=${params.model}. ` +
          `Returning accumulated content. inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens}`,
        );
        break;
      }

      // Append assistant turn and empty tool_results so built-in server-side
      // tools (e.g. web_search) can continue to the next turn.
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result' as const, tool_use_id: b.id, content: '' }));
      messages.push({ role: 'user', content: toolResults });
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
