export { BASE_QUESTIONS, questionsForChannel } from './base-questions.js';
export type { BaseQuestion } from './base-questions.js';

export { AUTO_RUN_ENABLED_ENV, isAutoRunEnabled } from './auto-run-flag.js';

// The three intake "has input?" questions (A suppression, B plannable) + C (form completeness).
export { hasIntakeContent, hasSuppressibleInput, hasPlannableInput, loadDurableInputs, DURABLE_INPUT_TYPES } from './intake-signals.js';
export type { SuppressibleCycle, PlannableCycle, DurableInputRow } from './intake-signals.js';
export { intakeCompleteness } from './intake-completeness.js';

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
export { resolvePillarWeights, spreadPillars } from './pillar-weights.js';
export type { PillarWeight, PillarWeights } from './pillar-weights.js';

export { DRAFT_FLOW_FLAG, readDraftFlowFlag } from './client-flags.js';
export { approveDraftCore, POST_STATUS_GENERATING, APPROVAL_MESSAGES } from './draft-approval-core.js';
export type { ApprovalError, ApprovalResult, ApproveDraftParams, ApprovalDb } from './draft-approval-core.js';

// ── Intake routing + reshaping (Build C) ─────────────────────────────────────
export { classifyIntake, routeFromParsed, parseClassification, parseBeatSpec, monthScopedIntentSchema, CLASSIFY_SYSTEM } from './intake-classify.js';
export type { IntakeRouting, MonthScopedIntent, EvergreenReason, ClassifyParams } from './intake-classify.js';
export {
  applyIntent, applyLaunchArc, applyEvent, applySeries, applyBeatSpec, applyCadence, expandSeries, applyEmphasis, applyBeatEdit,
  replacementCandidates, byWeakestEvidence, isReplaceable, replacementTier, isClientTouched, isClientOriginated,
  isClientAdded, isFromEarlierInput, POOL_EMPTY_NOTE, deriveTitle, resolveBeatRef,
} from './draft-transforms.js';
export type { TransformBeat, BeatOp, TransformResult, DeferredInstance } from './draft-transforms.js';
export { diffBeats, renderDiff, renderDelta, shortDate, isNoOp } from './draft-diff.js';
export type { DiffBeat, BeatDelta, DraftDiff } from './draft-diff.js';

// ── Draft-plan assembly (Build A) ────────────────────────────────────────────
export { observeHistory, observeCadence, observeFormats } from './draft-history.js';
export type { HistoryPost, HistoryObservation, CadenceObservation, FormatObservation } from './draft-history.js';
export { buildSkeleton, spreadDates, spreadFormats, slotCountFor, cadenceFloorSlots, DRAFT_MIN_POSTS } from './draft-skeleton.js';
export type { Skeleton, SkeletonSlot, BuildSkeletonParams } from './draft-skeleton.js';
export { allocateSlots, rankCandidates } from './draft-allocator.js';
export type { ExperimentCandidate, AllocatedSlot } from './draft-allocator.js';
export { assembleDraft, detectAssumptions, deterministicTitle, experimentTitle, STALE_TRAWL_DAYS } from './draft-assembly.js';
export type { DraftBeat, DraftPlan, AssembleDraftParams } from './draft-assembly.js';
export { phraseDraftTitles, applyPhrasing, parsePhrasing, validatePhrasing, PHRASING_SYSTEM } from './draft-phrasing.js';
export type { PhrasingModel, PhrasingResult } from './draft-phrasing.js';
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
  isEmptyBrief, isPlannableBrief, extractStructuredBrief, distributeBriefAnswers,
} from './brief-extract.js';
export type { BriefExtractParams, DistributeAnswersParams } from './brief-extract.js';

// Live planning-workspace preview (Phase 1) — cheap Haiku mirror of the in-progress brief.
export { previewBrief, EMPTY_PREVIEW, PREVIEW_MIN_CHARS } from './brief-preview.js';
export type { BriefPreview, PreviewItem, PreviewDate, PreviewDurable, PreviewBriefParams } from './brief-preview.js';

// Platform theming (admin-managed, global) — contrast maths + the activation gate.
export { luminance, contrastRatio, computeThemeContrast, themeActivatable, THEME_TOKEN_KEYS } from './contrast.js';
export type { ThemeTokens, ThemeContrast, ContrastRow } from './contrast.js';
