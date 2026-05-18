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

      const turnInput  = response.usage.input_tokens;
      const turnOutput = response.usage.output_tokens;
      totalInputTokens  += turnInput;
      totalOutputTokens += turnOutput;
      finalStopReason = response.stop_reason ?? 'end_turn';

      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock?.type === 'text') finalText = textBlock.text;

      console.info(
        `[anthropic] turn=${turnsUsed} model=${params.model} ` +
        `inputTokens=${turnInput} outputTokens=${turnOutput} stopReason=${finalStopReason}`,
      );

      if (response.stop_reason !== 'tool_use') break;

      if (turn === MAX_TOOL_TURNS - 1) {
        console.warn(
          `[AnthropicClient] max tool turns (${MAX_TOOL_TURNS}) reached for model=${params.model}. ` +
          `Forcing summarise turn. inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens}`,
        );
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: 'You have reached the search limit. Please now write up all the research you have gathered into a comprehensive summary.',
        });
        const summariseResponse = await this.client.messages.create({
          model: params.model,
          max_tokens: params.maxTokens ?? 4096,
          messages,
          ...(params.system !== undefined && { system: params.system }),
          // No tools — force a text response.
        });
        totalInputTokens  += summariseResponse.usage.input_tokens;
        totalOutputTokens += summariseResponse.usage.output_tokens;
        const summariseBlock = summariseResponse.content.find(b => b.type === 'text');
        if (summariseBlock?.type === 'text') finalText = summariseBlock.text;
        console.info(
          `[anthropic] summarise turn model=${params.model} ` +
          `inputTokens=${summariseResponse.usage.input_tokens} outputTokens=${summariseResponse.usage.output_tokens}`,
        );
        break;
      }

      messages.push({ role: 'assistant', content: response.content });
      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (b) => {
          const handler = params.toolHandlers?.[b.name];
          let resultContent = '';
          if (handler !== undefined) {
            try {
              const result = await handler(b.input ?? {});
              resultContent = typeof result === 'string' ? result : JSON.stringify(result);
            } catch (err) {
              console.warn(`[anthropic] tool handler "${b.name}" failed:`, err);
            }
          }
          return { type: 'tool_result' as const, tool_use_id: b.id, content: resultContent };
        }),
      );
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
