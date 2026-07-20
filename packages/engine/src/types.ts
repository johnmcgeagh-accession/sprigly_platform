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
// format_targets is intentionally absent: the planning agent reasons it from
// competitor analysis at plan time.
//
// Pillar shares were also absent, for the same reason — until the draft assembler
// (Build A). That assembler is DETERMINISTIC by contract: it must produce the same
// skeleton from the same inputs, with no model call, so it cannot "reason" a share
// the way the planning agent does. It needs a stored number. derivePillars has
// always computed one; toConfigPillars simply discarded it.

export interface Pillar {
  name: string;
  tagline: string;
  keyMessages: string[];
  contentIdeas: string[];
  /** Share of the client's posts this pillar represents, as an integer percentage
   *  (derivePillars asks for shares roughly summing to 100).
   *
   *  OPTIONAL, and stays optional: every config written before Build A has no
   *  sharePct, and those rows are still valid. Absence is resolved on READ by
   *  resolvePillarWeights() rather than backfilled — a backfill would mean
   *  re-running derivePillars per client, which is a billable non-deterministic
   *  model call that would invent weights nobody measured. Equal-share on read is
   *  both the smaller change and the more honest one, and the assembler records
   *  which basis it used in the beat's rationaleEvidence. */
  sharePct?: number;
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
  quotaExhausted?: boolean;  // Apify hit 402/429 during the last run (data may be partial/stale)
}

// ─── intake_json shape ───────────────────────────────────────────────────────
// Source-agnostic planning input store. Three future writers all produce this
// shape: manual entry (now), email-reply capture (later), voice note (later).
// 'source' distinguishes the writer; everything else is identical.
//
// planContent    → this month's planning answers; consumed by the planning worker
// businessContext → durable client facts captured during intake; accumulates over time
// otherChannel   → notes about channels other than the one being planned; parked for future writers

export interface PlanContentAnswers {
  answers:   Record<string, string>;  // questionText → answer
  freeNotes: string;
}

/**
 * @deprecated Captured-but-unconsumed. Durable cross-cycle context now lives in `plan_inputs`
 * (type 'idea' | 'next_cycle'), which the brief extractor reads live at generation time
 * (Build 3, Part B). `intake_json.businessContext` is per-cycle and NOT consumed by generation;
 * do not add new writers. New durable context must go to plan_inputs via saveDurableInput.
 */
export interface BusinessContextNote {
  note:       string;
  capturedAt: string;  // ISO date
}

export interface IntakeJson {
  planContent:     PlanContentAnswers;
  businessContext: BusinessContextNote[];
  otherChannel:    Record<string, string[]>;  // channel-name → notes array
  source:          'manual' | 'email' | 'voice';
  capturedAt:      string;  // ISO date
}

// ─── structured brief (brief-launch primitive) ───────────────────────────────
// The parsed, structured form of a client's unstructured planning brief
// (intake_json.planContent — answers + freeNotes), produced by the brief
// extractor (engine/src/content-cycles/brief-extract.ts). Later phases feed this
// into the catalogue-grounding vocabulary, the hard colourway validation, and the
// generation timing signal — none of which are wired yet.
//
// This is the DATA CONTRACT the extractor emits and persists verbatim: the field
// names match the extractor's JSON output exactly (snake_case launch_date /
// content_from / plan_window, as specified), so the persisted jsonb, the LLM
// output, and this type are one shape with no mapping layer.

export type BriefProductStatus = 'new' | 'restock';

// A launch / restock declaration lifted from the brief. One per (product,
// colourway) the client says is launching or returning this month.
export interface BriefProduct {
  product:      string;               // product / family name, as the client named it
  colourway:    string | null;        // the stated colourway, or null if none given
  status:       BriefProductStatus;   // "new" (brand new) vs "restock" (returning)
  launch_date:  string | null;        // ISO date (YYYY-MM-DD) it goes live, or null if undated
  content_from: string | null;        // ISO date content may start, or null
}

// A dated content beat from the brief. EXACTLY ONE of `date` (a single day) or
// `dateRange` (an inclusive span, for vague timing like "the last week of August")
// is non-null — the extract-gate rejects a beat with both or neither. Persisted
// pre-range beats carry `date` only; they read back as single-day beats unchanged.
export interface BriefScheduleBeat {
  date:      string | null;            // ISO date (YYYY-MM-DD) for a single-day beat; null for a range beat
  dateRange: { start: string; end: string } | null;  // inclusive ISO range for a vague-timing beat; null for a single day
  type:      string;                   // beat kind, e.g. "launch" | "weekend-style-guide" | "sunday-style"
  product:   string | null;           // the product this beat features, if named
  colourway: string | null;           // the colourway for this beat, if named
  note:      string;                   // the beat text, verbatim from the brief (vague phrasing preserved)
}

// An UNDATED content ask: a piece the brief asks for this month with no fixed
// date (Connie details, customer quotes, sensitive-skin education, BTS, Refer a
// Friend). Kept out of schedule[] (which is dated-only) so it is not lost.
export interface BriefContentAsk {
  type:    string;                     // kebab-case ask kind, e.g. "product-details" | "referral-reminder"
  product: string | null;             // the product it is about, or null
  note:    string;                     // the ask text, verbatim from the brief
}

// An internal contradiction in the brief the extractor must NOT resolve (e.g. one
// date assigned to two beats). Recorded here verbatim; the extractor keeps only
// dates literally present in the source rather than inventing one to de-collide.
export interface BriefConflict {
  description: string;                 // what the contradiction is
  dates:       string[] | null;        // ISO dates involved, if date-based; else null
  items:       string[] | null;        // the colliding beats / labels, if applicable; else null
}

export interface StructuredBrief {
  products:     BriefProduct[];        // launch / restock declarations
  schedule:     BriefScheduleBeat[];   // dated content beats (literal dates only)
  content_asks: BriefContentAsk[];     // undated briefed content pieces
  focus:        string[];              // primary hero families to feature
  conflicts:    BriefConflict[];       // internal contradictions, surfaced not resolved
  plan_window: {
    from:  string | null;              // ISO date the plan should start from, or null
    month: string | null;             // plan month, YYYY-MM, or null
  };
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
