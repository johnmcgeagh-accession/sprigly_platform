/**
 * brief-extract.ts — re-export shim. The extractor moved to @sprigly/engine (Build 5, FIX 2)
 * so the worker (planning) and the app (intake route, extract-on-submit) share ONE implementation.
 * Worker consumers keep importing from './brief-extract.js' unchanged.
 */
export {
  EMPTY_STRUCTURED_BRIEF,
  buildBriefExtractUserMessage,
  parseBriefResponse,
  validateStructuredBrief,
  isEmptyBrief,
  extractStructuredBrief,
  distributeBriefAnswers,
} from '@sprigly/engine';
export type { BriefExtractParams, DistributeAnswersParams } from '@sprigly/engine';
