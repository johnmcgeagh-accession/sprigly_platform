export type WorkflowOutcome = 'handled' | 'needs_human' | 'deferred';

export type SourceType =
  | "email"
  | "sms"
  | "slack"
  | "form"
  | "voice"
  | "webhook"
  | "schedule"
  | "drive";

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

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;   // short relevance excerpt from provider
  content?: string;  // longer raw content if requested
  score?: number;    // provider relevance score
}

export interface WebSearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

export interface TriageCategory {
  key: string;
  label: string;
  description: string;
  action: 'draft_reply' | 'escalate' | 'label' | `invoke_workflow:${string}`;
  graduationEligible: boolean;
  escalationReason?: string;
  escalationContext?: string;
}

export interface ReplyExample {
  inbound: string;
  reply: string;
  note?: string;
}

export interface TriageConfig {
  categories: TriageCategory[];
  voiceSample: string;
  replyExamples: ReplyExample[];
  additionalInstructions?: string;
}

// ─── client_planning_config JSONB shapes ──────────────────────────────────────
// Per-(client, channel) content planning configuration for the content-cycle
// planning phase. The planning worker treats missing/empty fields as "not yet
// configured" and surfaces a readiness error rather than silently defaulting.
//
// format_targets and pillar % target shares are intentionally absent:
// the planning agent reasons both from competitor analysis at plan time.

export interface Pillar {
  name: string;
  tagline: string;
  keyMessages: string[];
  contentIdeas: string[];
}

export interface Cadence {
  postsPerMonthMin: number;
  postsPerMonthMax: number;
  maxPerWeek: number;
  minPerWeek: number;
}

export type SeriesDayOfWeek =
  | 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday'
  | 'Thursday' | 'Friday' | 'Saturday'
  | 'monthly';

export type SeriesFormat = 'Reel' | 'Carousel' | 'Static' | 'Reel or Carousel' | null;
export type SeriesWhoPosts = 'Sprigly' | 'Sally posting' | 'Sally only';

export interface RecurringSeries {
  name: string;
  dayOfWeek: SeriesDayOfWeek;
  time: string;              // e.g. '8pm'; 'monthly' when dayOfWeek = 'monthly'
  format: SeriesFormat;      // null when Sally owns the format entirely
  whoPosts: SeriesWhoPosts;
}

export interface PostingTimes {
  launch: string;      // e.g. '6am'
  morning: string;     // e.g. '7am'
  evening: string;     // e.g. '7pm'
  wsg: string;         // e.g. '6pm'
  sundayStyle: string; // e.g. '8pm'
}

export interface PlanningConfig {
  pillars: Pillar[];
  competitors: string[];
  cadence: Cadence;
  recurringSeries: RecurringSeries[];
  postingTimes: PostingTimes;
  categories: string[];
}

// ─── competitor_gather_cache JSONB shapes ──────────────────────────────────────
// Structured output of the deterministic gather phase (competitor-gather.ts).
// Stored in competitor_gather_cache.raw_data. Consumed by the LLM analysis
// worker (Stage 2) to produce strategic findings and the planning agent summary.
//
// Per-handle fetchedAt enables staleness checks at the individual handle level
// so re-runs only re-fetch handles that are > 30 days old.

export interface ScoredIgPost {
  timestamp:       string;
  type:            string;    // 'Reel' | 'Carousel' | 'Static'
  likes:           number;
  comments:        number;
  views:           number;
  caption?:        string;
  engagementScore: number;    // likes + comments*3
  wordCount:       number;
  hasQuestion:     boolean;
  hasCta:          boolean;
  emojiCount:      number;
  hashtagCount:    number;
}

export interface CompetitorFormatBreakdown {
  type:          string;
  count:         number;
  avgEngagement: number;
  topScore:      number;
}

export interface CompetitorTop5Post {
  timestamp:       string;
  type:            string;
  engagementScore: number;
  captionSnippet:  string;
}

export interface CompetitorAccountStats {
  handle:          string;
  postCount:       number;
  avgEngagement:   number;
  topPostScore:    number;
  postsPerWeek:    number;
  dateRange:       { oldest: string; newest: string };
  formatBreakdown: CompetitorFormatBreakdown[];
  top5Posts:       CompetitorTop5Post[];
}

export interface CompetitorAccountCache {
  handle:    string;
  fetchedAt: string;   // ISO date — used for per-handle staleness (30-day rule)
  posts:     ScoredIgPost[];
  stats:     CompetitorAccountStats;
}

export interface CompetitorBenchmarkRow {
  handle:        string;
  avgEngagement: number;
  topPostScore:  number;
  bestType:      string;
  postsPerWeek:  number;
}

export interface CompetitorGatherData {
  accounts:   CompetitorAccountCache[];
  benchmark:  CompetitorBenchmarkRow[];
  gatheredAt: string;   // ISO date of the most recent gather run
}

export interface TriageStore {
  writeSeenMessage(params: {
    clientId: string;
    messageId: string;
    threadId: string;
    outcome: WorkflowOutcome;
  }): Promise<void>;
  writeCaptureLogDraft(params: {
    clientId: string;
    eventId: string;
    workflowRunId: string;
    category: string;
    suggestedAction: string;
    draftText?: string;
    escalationReason?: string;
  }): Promise<string>;
}

/** Minimal embedding interface — keeps @sprigly/engine free of the embedding-client dep. */
export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

/** One row from knowledge_topics — loaded by WorkflowRunner for question-answerer. */
export interface KnowledgeTopicSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface WorkflowContext {
  clientId: string;
  clientConfig: ClientConfig;
  model: ModelClient;
  audit: AuditLogger;
  prompts: PromptResolver;
  eventId: string;
  runId: string;
  search?: WebSearchProvider;
  triageConfig?: TriageConfig;
  triageStore?: TriageStore;
  embeddingClient?: EmbeddingClient;
  knowledgeTopics?: KnowledgeTopicSummary[];
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
