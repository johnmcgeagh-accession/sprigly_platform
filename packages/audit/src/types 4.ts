export interface LogModelCallParams {
  clientId: string;
  eventId?: string;
  runId?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogger {
  logModelCall(params: LogModelCallParams): Promise<void>;
}
