export type SourceType =
  | "email"
  | "sms"
  | "slack"
  | "form"
  | "voice"
  | "webhook"
  | "schedule";

// Minimum shape needed for routing rule evaluation — no DB id, no reply context.
// Use this before deciding whether to persist an incoming message.
export interface IncomingEventDraft {
  clientId: string;
  source: SourceType;
  sourceMetadata: Record<string, unknown>;
  content: {
    text: string;
    structured?: Record<string, unknown>;
  };
}

// Persisted event — extends the draft with DB-assigned fields and reply context.
export interface IncomingEvent extends IncomingEventDraft {
  id: string;
  receivedAt: Date;
  content: {
    text: string;
    attachments?: Attachment[];
    structured?: Record<string, unknown>;
  };
  reply: ReplyContext;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface ReplyContext {
  channel: SourceType;
  data: Record<string, unknown>;
}

export interface Workflow<TInput = unknown, TOutput = unknown> {
  id: string;
  /**
   * Fallback destinations used when a routing rule's destinations array is empty ([]).
   * Routing rules may override this with a non-empty destinations array.
   */
  defaultDestinations: DestinationConfig[];
  parseInput(event: IncomingEvent): TInput | null;
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
}

export interface WorkflowContext {
  clientId: string;
  clientConfig: ClientConfig;
  model: ModelClient;
  audit: AuditLogger;
  prompts: PromptResolver;
  eventId: string;
  runId: string;
  /** When true: audit logs go to console only; destinations must skip real writes. */
  dryRun?: boolean;
}

export interface ClientConfig {
  id: string;
  clientId: string;
  brandVoice: string;
  signature: string;
  authorName: string;
  settings: Record<string, unknown>;
}

export interface ModelClient {
  complete(params: ModelCompleteParams): Promise<ModelCompleteResult>;
}

export interface ModelCompleteParams {
  model: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  tools?: unknown[];
}

export interface ModelCompleteResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  stopReason: string;
  toolTurns?: number;
}

export interface AuditLogger {
  logModelCall(params: {
    clientId: string;
    eventId?: string;
    runId?: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    action?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface PromptResolver {
  resolve(clientId: string, workflowId: string, stepName: string): Promise<string>;
}

export interface DeliveryContext {
  runId: string;
  workflowId: string;
  clientId: string;
}

export interface Destination<TOutput = unknown> {
  id: string;
  deliver(
    output: TOutput,
    event: IncomingEvent,
    config: DestinationConfig,
    ctx: DeliveryContext,
  ): Promise<DeliveryResult>;
  requiresApproval(config: DestinationConfig): boolean;
}

/**
 * Configuration for a delivery destination.
 *
 * Dynamic value resolution in settings:
 *   settings.to = "sender"  →  resolves to event.reply.data['from'] at delivery time.
 *                               Use this when output should be sent back to the trigger sender.
 *   Any other string value   →  used as a literal (e.g. a fixed email address or queue name).
 *
 * Routing rules store a destinations array. If the array is empty ([]),
 * DestinationDispatcher falls back to the workflow's defaultDestinations.
 */
export interface DestinationConfig {
  destinationId: string;
  requireApproval?: boolean;
  settings: Record<string, unknown>;
}

export interface DeliveryResult {
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface RoutingRule {
  id: string;
  clientId: string;
  enabled: boolean;
  match: {
    source: SourceType;
    conditions: MatchCondition[];
  };
  workflowId: string;
  destinations: DestinationConfig[];
  clientConfigId: string;
  priority: number;
  isFallback: boolean;
}

export interface MatchCondition {
  field: string;
  op: "equals" | "contains" | "startsWith" | "endsWith" | "regex";
  value: string;
  caseSensitive?: boolean;
}
