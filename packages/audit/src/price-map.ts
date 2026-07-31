// Rates in pence per 1M tokens.
// Source: Anthropic public USD pricing converted at ~0.79 GBP/USD, rounded.
// Bedrock rates carry a ~15% cross-region inference premium verified empirically
// across two eval runs (eu-west-2, haiku 4.5, 2026-05-14).
//
// To update: adjust the RATES table below. No other files need changing —
// computeCostPence() detects family and provider from the model ID string.

type ModelFamily   = 'haiku' | 'sonnet' | 'opus' | 'titan';
type ModelProvider = 'anthropic' | 'bedrock';

interface TokenRates { inputPer1M: number; outputPer1M: number }

const RATES: Record<ModelFamily, Record<ModelProvider, TokenRates>> = {
  haiku: {
    anthropic: { inputPer1M: 60,   outputPer1M: 320  },  // $0.80/$4.00/MTok
    bedrock:   { inputPer1M: 69,   outputPer1M: 368  },  // × 1.15 cross-region premium
  },
  sonnet: {
    anthropic: { inputPer1M: 240,  outputPer1M: 1180 },  // $3.00/$15.00/MTok
    bedrock:   { inputPer1M: 276,  outputPer1M: 1357 },  // × 1.15 cross-region premium
  },
  opus: {
    anthropic: { inputPer1M: 1180, outputPer1M: 5930 },  // $15.00/$75.00/MTok
    bedrock:   { inputPer1M: 1357, outputPer1M: 6820 },  // × 1.15; placeholder — not yet available on Bedrock eu-west-2
  },
  // Amazon Titan Text Embeddings V2 — $0.02/MTok input, no output tokens.
  // 0.02 USD × 79 p/USD = 1.58 p per 1M, i.e. ~0.00008p for a typical query embed.
  //
  // BOTH provider rows carry the same number, and that is not an oversight: Titan is an
  // Amazon model with no Anthropic equivalent, and it is invoked DIRECTLY (InvokeModel with
  // the bare id `amazon.titan-embed-text-v2:0`) rather than through a cross-region inference
  // profile — so it carries no cross-region premium AND it does not match the `eu.`/`us.`
  // prefix detectProvider() keys on. Writing the rate once per provider keeps the table's
  // shape uniform and makes the answer right whichever way the id is classified.
  titan: {
    anthropic: { inputPer1M: 1.58, outputPer1M: 0 },
    bedrock:   { inputPer1M: 1.58, outputPer1M: 0 },
  },
};

function detectFamily(modelId: string): ModelFamily | null {
  if (modelId.includes('haiku'))  return 'haiku';
  if (modelId.includes('sonnet')) return 'sonnet';
  if (modelId.includes('opus'))   return 'opus';
  if (modelId.includes('titan'))  return 'titan';
  return null;
}

function detectProvider(modelId: string): ModelProvider {
  // Bedrock cross-region inference profile IDs start with a region prefix (eu. / us.)
  return /^(eu|us)\./.test(modelId) ? 'bedrock' : 'anthropic';
}

/**
 * SUB-PENNY PRECISION, and why it is not a rounding preference.
 *
 * This used to end `Math.ceil(inputCost + outputCost)`, which cannot return anything between
 * 0 and 1: every call that genuinely cost a fraction of a penny was posted to the ledger as a
 * whole penny. On the batch paths that barely showed — a Sonnet brief extraction costs several
 * pence, so the ceil was a rounding artefact. On the CONVERSATIONAL path it is the whole
 * measurement: a Haiku parse turn costs ~0.55p and a Titan query embed costs ~0.00008p, and
 * ceil reports them as 1p and 1p — the second overstated by a factor of twelve thousand, and
 * the two indistinguishable from each other on a ledger meant to tell them apart.
 *
 * So the function now returns the real number and the storage carries it (cost_pence is
 * numeric(12,6) — migration 0091). Six decimal places is micropence: enough that a single
 * Titan embed is a non-zero row rather than a fake 0, and 1M such rows still sum exactly.
 * Rounding happens at RENDER only (admin/audit formats to £x.xx).
 *
 * The unit did not change. A cost_pence of 1 meant one penny before and means one penny now;
 * the column simply stopped refusing to hold 0.55.
 */
const MICROPENCE_DP = 6;

/**
 * PROMPT-CACHE MULTIPLIERS, applied to the family's own base INPUT rate.
 *
 * Source: Anthropic's published prompt-caching pricing, which Amazon Bedrock mirrors for the
 * Anthropic model families — cache reads bill at 0.1× the base input rate, and a cache WRITE
 * bills at a premium over it because the prefix has to be processed once to be stored.
 *   · https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching  (pricing section)
 *   · https://aws.amazon.com/bedrock/pricing/                             (prompt caching)
 *
 * The write premium depends on the entry's TTL: 1.25× for the default five-minute cache, 2× for
 * the one-hour cache. `bedrock-client.ts` emits `cachePoint: { type: 'default' }` with no `ttl`,
 * which is the five-minute entry — so 1.25× is the right constant for what this codebase
 * actually sends. If a caller ever passes `ttl: '1h'`, this number becomes wrong and the
 * multiplier has to move onto the call alongside it.
 *
 * These are ratios rather than a second rate table on purpose: they hold across the Anthropic
 * families, so expressing them as multipliers means a base-rate correction propagates to the
 * cached figures automatically instead of leaving three numbers to update by hand.
 */
const CACHE_READ_MULTIPLIER  = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;   // five-minute TTL; 2.0 for the one-hour cache

/**
 * The cache token counts for a call, as the provider reported them.
 *
 * These are DISJOINT from `inputTokens`, verified empirically against Bedrock on 2026-07-31:
 * a turn that wrote 5,712 tokens of prefix reported `inputTokens: 25` alongside it. So they are
 * added to the bill, never subtracted from it — pricing `inputTokens` alone was what made a
 * cached turn post ~88% light.
 */
export interface CacheTokens {
  cacheReadTokens?:  number | undefined;
  cacheWriteTokens?: number | undefined;
}

export function computeCostPence(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cache: CacheTokens = {},
): number {
  const family = detectFamily(modelId);
  if (!family) return 0;
  const provider = detectProvider(modelId);
  const r = RATES[family][provider];
  const inputCost  = (inputTokens  / 1_000_000) * r.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * r.outputPer1M;
  const cacheReadCost  = ((cache.cacheReadTokens  ?? 0) / 1_000_000) * r.inputPer1M * CACHE_READ_MULTIPLIER;
  const cacheWriteCost = ((cache.cacheWriteTokens ?? 0) / 1_000_000) * r.inputPer1M * CACHE_WRITE_MULTIPLIER;
  // Round to micropence rather than truncating: binary floating point cannot represent these
  // products exactly, and an unrounded value would carry ~1e-17 of noise into a numeric column
  // that would then reject or silently truncate it.
  return Number((inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(MICROPENCE_DP));
}
