import type { ModelClient, ModelCompleteParams, ModelCompleteResult } from './types.js';

export type LogicalModelName = 'haiku' | 'sonnet' | 'opus';

const LOGICAL_NAMES = new Set<string>(['haiku', 'sonnet', 'opus']);

/**
 * Wraps a ModelClient and translates logical model names → provider-specific physical IDs.
 *
 * Logical names: "haiku" | "sonnet" | "opus"
 * Physical IDs are provider-specific and injected at construction time from env vars.
 *
 * Rules:
 *   - Known logical name present in map → resolved to physical ID
 *   - Known logical name NOT in map → throws (config error, caught at startup)
 *   - Anything else (a physical ID string) → forwarded as-is
 *
 * Resolution happens at call time using the map built at construction, not by re-reading env vars.
 */
export class ResolvedModelClient implements ModelClient {
  constructor(
    private inner: ModelClient,
    private map: Partial<Record<LogicalModelName, string>>,
  ) {}

  private resolve(params: ModelCompleteParams): ModelCompleteParams {
    if (!LOGICAL_NAMES.has(params.model)) return params; // physical ID — forward as-is
    const physicalId = this.map[params.model as LogicalModelName];
    if (physicalId === undefined) {
      throw new Error(
        `Logical model name "${params.model}" is not mapped to a physical ID. ` +
        `Check BEDROCK_MODEL_ID_${params.model.toUpperCase()} / ANTHROPIC_MODEL_ID_${params.model.toUpperCase()} env vars.`,
      );
    }
    return { ...params, model: physicalId };
  }

  async complete(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    return this.inner.complete(this.resolve(params));
  }

  async completeStreaming(params: ModelCompleteParams): Promise<ModelCompleteResult> {
    return this.inner.completeStreaming(this.resolve(params));
  }
}

/**
 * Anthropic versionless aliases — Anthropic routes these to the latest patch
 * within the named model family, so they remain valid without manual updates.
 */
export const ANTHROPIC_DEFAULTS: Record<LogicalModelName, string> = {
  haiku:  'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-8',
};

/**
 * No Bedrock defaults. Bedrock requires full versioned cross-region inference profile IDs
 * (e.g. eu.anthropic.claude-haiku-3-5-20251001-v1:0) which expire as models are updated.
 * Set BEDROCK_MODEL_ID_HAIKU/SONNET/OPUS explicitly to avoid stale hardcoded IDs.
 */
