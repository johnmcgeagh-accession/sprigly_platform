export { BASE_QUESTIONS } from './base-questions.js';
export type { BaseQuestion } from './base-questions.js';

export type {
  IncomingEventDraft,
  IncomingEvent,
  Attachment,
  ReplyContext,
  SourceType,
  WorkflowOutcome,
  Workflow,
  WorkflowContext,
  ClientConfig,
  ModelClient,
  ModelCompleteParams,
  ModelCompleteResult,
  AuditLogger,
  PromptResolver,
  Destination,
  DeliveryContext,
  DestinationConfig,
  DeliveryResult,
  RoutingRule,
  MatchCondition,
  SearchResult,
  WebSearchProvider,
  TriageCategory,
  ReplyExample,
  TriageConfig,
  TriageStore,
  EmbeddingClient,
  KnowledgeTopicSummary,
  Pillar,
  Cadence,
  RecurringSeries,
  PostingTimes,
  PlanningConfig,
  SeriesDayOfWeek,
  SeriesFormat,
  SeriesWhoPosts,
  ScoredIgPost,
  CompetitorFormatBreakdown,
  CompetitorTop5Post,
  CompetitorAccountStats,
  CompetitorAccountCache,
  CompetitorBenchmarkRow,
  CompetitorGatherData,
  PlanContentAnswers,
  BusinessContextNote,
  IntakeJson,
  BriefProductStatus,
  BriefProduct,
  BriefScheduleBeat,
  BriefContentAsk,
  BriefConflict,
  StructuredBrief,
} from './types.js';
export { recordResolution } from './resolution.js';
export type { RecordResolutionParams } from './resolution.js';
export { stripBuffers } from './strip-buffers.js';
export { WorkflowRegistry } from './workflow-registry.js';
export { EventRouter, extractField, evaluateCondition, evaluateConditions, matchRules } from './event-router.js';
export { WorkflowRunner } from './workflow-runner.js';
export { DestinationDispatcher } from './destination-dispatcher.js';
export { buildCatalogue, parseProductTitle } from './catalogue/parse-catalogue.js';
export type {
  Catalogue, ParsedProduct, ProductFamily, ProductStatus, SalesRow, VariantSales,
} from './catalogue/parse-catalogue.js';

// Intake-capture shared pure logic (Build 4) — sender + admin source these so they can't drift.
export { AUTO_RUN_MIN_WINDOW, deriveTouchSchedule, dueTouchForDay } from './touch-schedule.js';
export type { Touch, TouchSchedule } from './touch-schedule.js';
export {
  MERGE_FIELDS, KNOWN_MERGE_FIELDS, unknownMergeFields, renderField, renderEmailTemplate,
} from './email-render.js';
export type { MergeField, MergeData, RenderableTemplate, RenderedEmail } from './email-render.js';

// Structured-brief extractor (Build 5, FIX 2) — moved here so the worker (planning) AND the app
// (intake route, extract-on-submit) share one extractor.
export {
  EMPTY_STRUCTURED_BRIEF, buildBriefExtractUserMessage, parseBriefResponse, validateStructuredBrief,
  isEmptyBrief, extractStructuredBrief, distributeBriefAnswers,
} from './brief-extract.js';
export type { BriefExtractParams, DistributeAnswersParams } from './brief-extract.js';

// Live planning-workspace preview (Phase 1) — cheap Haiku mirror of the in-progress brief.
export { previewBrief, EMPTY_PREVIEW, PREVIEW_MIN_CHARS } from './brief-preview.js';
export type { BriefPreview, PreviewItem, PreviewDate, PreviewDurable, PreviewBriefParams } from './brief-preview.js';
