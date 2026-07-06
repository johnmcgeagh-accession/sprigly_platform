export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface ModelCompleteParams {
  model: string;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
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
}

export interface ModelClient {
  complete(params: ModelCompleteParams): Promise<ModelCompleteResult>;
  completeStreaming(params: ModelCompleteParams): Promise<ModelCompleteResult>;
}
