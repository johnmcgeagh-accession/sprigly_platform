import Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, ModelCompleteParams, ModelCompleteResult, ModelMessage } from './types.js';

const MAX_TOOL_TURNS = 20;

/**
 * One message → Anthropic content. CACHE BREAKPOINTS ARE DROPPED HERE, DELIBERATELY.
 *
 * Anthropic does support prompt caching, and marks it as `cache_control` on the last block of
 * the prefix rather than as a standalone block. But this package is pinned to @anthropic-ai/sdk
 * ^0.27.0, where caching was still a beta surface (`client.beta.promptCaching.messages`) with no
 * `cache_control` on the GA message params and no `cache_read_input_tokens` on `usage`. There is
 * no way to express the breakpoint through the call this client makes.
 *
 * So it is dropped rather than faked. Parts are concatenated back into the continuous string the
 * model would have seen anyway — the prompt is byte-identical to the uncached one, which is the
 * correct behaviour for a provider that cannot honour the marker: the call costs what it always
 * did, and `cacheReadTokens` stays absent rather than reporting a zero that would read as a
 * cache miss to investigate.
 *
 * This matters little in practice and is worth stating anyway: MODEL_PROVIDER=bedrock is the
 * deployed path (Railway/UAT/prod, eu-west-2), and this client is the local-dev alternative.
 * Caching on this path needs an SDK upgrade, not a code change here.
 */
function toAnthropicContent(m: ModelMessage): string {
  if (typeof m.content === 'string') return m.content;
  return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

export class AnthropicClient implements ModelClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    const messages: Anthropic.MessageParam[] = params.messages.map(m => ({
      role: m.role,
      content: toAnthropicContent(m),
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
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        ...(params.system !== undefined && { system: params.system }),
        ...(params.tools !== undefined && { tools: params.tools as Anthropic.Tool[] }),
      });

      const turnInput  = response.usage.input_tokens;
      const turnOutput = response.usage.output_tokens;
      totalInputTokens  += turnInput;
      totalOutputTokens += turnOutput;
      // No cache counters read: see toAnthropicContent — the pinned SDK's `usage` does not carry
      // them, and reporting 0 would be indistinguishable from a real cache miss.
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

  async completeStreaming(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    // Anthropic SDK has no 180s socket issue; delegate to complete() for local dev.
    return this.complete(params);
  }
}
