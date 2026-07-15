/**
 * brief-preview test (Phase 1) — the live Haiku preview maps sections, carries durable provenance,
 * short-circuits tiny input with no model call, and is non-fatal (empty preview) on any failure.
 */
import { describe, it, expect, vi } from 'vitest';
import { previewBrief, EMPTY_PREVIEW } from '@sprigly/engine';
import type { ModelClient } from '@sprigly/model-client';

function model(json: string) {
  return { complete: vi.fn(async () => ({ content: json, inputTokens: 1, outputTokens: 1, modelId: 'm', stopReason: 'end_turn' })) } as unknown as ModelClient;
}

describe('previewBrief', () => {
  it('maps sections + one followUp, drops empty items, and keeps durable provenance (from)', async () => {
    const m = model(JSON.stringify({
      campaigns: [{ text: 'Weekend sale', from: null }, { text: '   ', from: null }],
      dates: [{ when: '25th', what: 'launch', from: null }],
      products: [{ text: 'Aurora range', from: 'June' }],
      themes: [], availability: [], ideas: [],
      followUp: 'Any key dates this month?',
    }));
    const p = await previewBrief({ text: 'launching the aurora range on the 25th, plus a sale', model: m });
    expect(p.campaigns).toEqual([{ text: 'Weekend sale', from: null }]);   // empty dropped
    expect(p.dates).toEqual([{ when: '25th', what: 'launch', from: null }]);
    expect(p.products).toEqual([{ text: 'Aurora range', from: 'June' }]);   // durable provenance preserved
    expect(p.followUp).toBe('Any key dates this month?');
  });

  it('short input → EMPTY_PREVIEW with NO model call', async () => {
    const m = model('{}');
    expect(await previewBrief({ text: 'hi', model: m })).toEqual(EMPTY_PREVIEW);
    expect(m.complete as unknown as { mock: unknown }).toBeDefined();
    expect((m.complete as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('is non-fatal — a model/parse failure yields EMPTY_PREVIEW', async () => {
    const m = { complete: vi.fn(async () => { throw new Error('boom'); }) } as unknown as ModelClient;
    expect(await previewBrief({ text: 'a genuinely long enough brief to preview', model: m })).toEqual(EMPTY_PREVIEW);
  });
});
