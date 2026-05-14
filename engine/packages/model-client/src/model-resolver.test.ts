import { describe, it, expect, vi } from 'vitest';
import { ResolvedModelClient, ANTHROPIC_DEFAULTS } from './model-resolver.js';
import type { ModelClient, ModelCompleteParams, ModelCompleteResult } from './types.js';

const STUB_RESULT: ModelCompleteResult = {
  content: 'ok',
  inputTokens: 10,
  outputTokens: 5,
  modelId: 'resolved-id',
  stopReason: 'end_turn',
};

function makeInner(): ModelClient & { lastModel: string } {
  const inner = {
    lastModel: '',
    complete: vi.fn(async (params: ModelCompleteParams): Promise<ModelCompleteResult> => {
      inner.lastModel = params.model;
      return { ...STUB_RESULT, modelId: params.model };
    }),
  };
  return inner;
}

describe('ResolvedModelClient', () => {
  it('resolves a logical name to its mapped physical ID', async () => {
    const inner = makeInner();
    const client = new ResolvedModelClient(inner, {
      haiku: 'eu.anthropic.claude-haiku-3-5-20251001-v1:0',
    });
    await client.complete({ model: 'haiku', messages: [] });
    expect(inner.lastModel).toBe('eu.anthropic.claude-haiku-3-5-20251001-v1:0');
  });

  it('passes a physical ID through unchanged when it is not a known logical name', async () => {
    const inner = makeInner();
    const client = new ResolvedModelClient(inner, {});
    const physicalId = 'eu.anthropic.claude-haiku-3-5-20251001-v1:0';
    await client.complete({ model: physicalId, messages: [] });
    expect(inner.lastModel).toBe(physicalId);
  });

  it('throws when a known logical name is not in the map', async () => {
    const inner = makeInner();
    const client = new ResolvedModelClient(inner, {}); // no 'sonnet' entry
    await expect(client.complete({ model: 'sonnet', messages: [] })).rejects.toThrow(
      /sonnet.*not mapped/,
    );
  });

  it('throws for any logical name when the map is empty', async () => {
    const inner = makeInner();
    const client = new ResolvedModelClient(inner, {});
    for (const name of ['haiku', 'sonnet', 'opus'] as const) {
      await expect(client.complete({ model: name, messages: [] })).rejects.toThrow(
        /not mapped/,
      );
    }
  });

  it('uses an env-overridden physical ID over the default when injected via map', async () => {
    const inner = makeInner();
    const overriddenId = 'eu.anthropic.claude-haiku-3-5-CUSTOM-v1:0';
    // The map is the mechanism by which factory injects env overrides
    const client = new ResolvedModelClient(inner, {
      haiku:  overriddenId,
      sonnet: ANTHROPIC_DEFAULTS.sonnet,
      opus:   ANTHROPIC_DEFAULTS.opus,
    });
    await client.complete({ model: 'haiku', messages: [] });
    expect(inner.lastModel).toBe(overriddenId);
    // sonnet still uses the default
    await client.complete({ model: 'sonnet', messages: [] });
    expect(inner.lastModel).toBe(ANTHROPIC_DEFAULTS.sonnet);
  });
});
