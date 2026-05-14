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
  tools?: AnthropicTool[];
}

export interface ModelCompleteResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  stopReason: string;
}

export interface ModelClient {
  complete(params: ModelCompleteParams): Promise<ModelCompleteResult>;
}
