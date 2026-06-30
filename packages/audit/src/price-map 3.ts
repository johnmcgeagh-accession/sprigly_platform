// Rates in pence per 1M tokens.
// Source: Anthropic public USD pricing converted at ~0.79 GBP/USD, rounded.
// Bedrock rates carry a ~15% cross-region inference premium verified empirically
// across two eval runs (eu-west-2, haiku 4.5, 2026-05-14).
//
// To update: adjust the RATES table below. No other files need changing —
// computeCostPence() detects family and provider from the model ID string.

type ModelFamily   = 'haiku' | 'sonnet' | 'opus';
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
};

function detectFamily(modelId: string): ModelFamily | null {
  if (modelId.includes('haiku'))  return 'haiku';
  if (modelId.includes('sonnet')) return 'sonnet';
  if (modelId.includes('opus'))   return 'opus';
  return null;
}

function detectProvider(modelId: string): ModelProvider {
  // Bedrock cross-region inference profile IDs start with a region prefix (eu. / us.)
  return /^(eu|us)\./.test(modelId) ? 'bedrock' : 'anthropic';
}

export function computeCostPence(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const family = detectFamily(modelId);
  if (!family) return 0;
  const provider = detectProvider(modelId);
  const r = RATES[family][provider];
  const inputCost  = (inputTokens  / 1_000_000) * r.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * r.outputPer1M;
  return Math.ceil(inputCost + outputCost);
}
