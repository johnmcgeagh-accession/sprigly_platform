export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * A piece of one message.
 *
 * `cache_point` is a BREAKPOINT, not content: everything rendered before it — tools, system, and
 * every earlier part — is the cacheable prefix, and a later request whose prefix is byte-identical
 * up to that point reads it back instead of re-processing it. It is provider-neutral on purpose;
 * each client below spells it in its own provider's dialect (Bedrock `cachePoint`, Anthropic
 * `cache_control`), and a provider without caching simply drops it.
 *
 * The rule that makes it work: STABLE CONTENT BEFORE THE BREAKPOINT, VARIABLE CONTENT AFTER.
 * One byte of drift anywhere in the prefix — a timestamp, a re-ordered key — and the cache misses
 * silently, costing the write premium and returning nothing.
 */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'cache_point' };

export interface ModelMessage {
  role: 'user' | 'assistant';
  /** A plain string is one text part — every existing caller stays as it was. */
  content: string | MessagePart[];
}

export interface ModelCompleteParams {
  model: string;
  system?: string;
  messages: ModelMessage[];
  maxTokens?: number;
  /** Sampling temperature. Omit for the provider default; set 0 for
   *  deterministic structured-output calls (e.g. the plan agent's intent router). */
  temperature?: number;
  tools?: unknown[];
  toolHandlers?: Record<string, (input: unknown) => Promise<unknown>>;
}

export interface ModelCompleteResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  stopReason: string;
  toolTurns?: number;
  /**
   * Prefix tokens served from cache, and prefix tokens written to it. Present only when the
   * provider reports them, which is also the only honest way to answer "is caching actually
   * working" — a `cache_point` that lands on an unsupported model, or on a prefix below the
   * model's minimum cacheable length, fails SILENTLY and looks exactly like one that worked.
   * A zero read across repeated identical-prefix calls is the symptom to look for.
   *
   * NOTE for costing: these are counted SEPARATELY from `inputTokens` by the provider — a turn
   * that reads a 5,209-token prefix reports `inputTokens: 27` beside it — so they are ADDED to
   * the bill, never subtracted from it. `computeCostPence` takes them as a fourth argument and
   * prices them (0.1× the base input rate for a read, 1.25× for a five-minute write); the older
   * note here saying it prices `inputTokens` alone described the bug that change fixed, not the
   * behaviour. See docs/reports/conversational-cost.md.
   */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ModelClient {
  complete(params: ModelCompleteParams): Promise<ModelCompleteResult>;
  completeStreaming(params: ModelCompleteParams): Promise<ModelCompleteResult>;
}
