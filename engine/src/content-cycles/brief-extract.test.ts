/**
 * brief-extract test (Build 3, Part B) — durable cross-cycle context is threaded into the
 * extractor input as a section DISTINCT from this month's brief, and durable-only input still
 * extracts (no longer short-circuited to empty).
 */
import { describe, it, expect, vi } from 'vitest';
import { buildBriefExtractUserMessage, extractStructuredBrief, EMPTY_STRUCTURED_BRIEF } from './brief-extract.js';
import type { ModelClient } from '@sprigly/model-client';

describe('buildBriefExtractUserMessage', () => {
  it('includes a DURABLE CONTEXT section, after and distinct from the brief', () => {
    const msg = buildBriefExtractUserMessage(
      { answers: { 'Any key dates?': 'launch on the 5th' }, freeNotes: 'a note' },
      '2026-08',
      ['[idea] lean into provenance', '[next_cycle] plan a Connie relaunch'],
    );
    expect(msg).toContain('BRIEF — structured answers:');
    expect(msg).toContain('DURABLE CONTEXT');
    expect(msg).toContain('- [idea] lean into provenance');
    expect(msg).toContain('- [next_cycle] plan a Connie relaunch');
    expect(msg.indexOf('DURABLE CONTEXT')).toBeGreaterThan(msg.indexOf('BRIEF — structured answers:'));
  });

  it('omits the durable section entirely when there is none', () => {
    expect(buildBriefExtractUserMessage({ answers: { Q1: 'x' }, freeNotes: '' }, '2026-08', [])).not.toContain('DURABLE CONTEXT');
  });
});

function mockModel(capture: { userMessage?: string }) {
  const complete = vi.fn(async (p: { messages: Array<{ content: string }> }) => {
    capture.userMessage = p.messages[0]!.content;
    return { content: JSON.stringify(EMPTY_STRUCTURED_BRIEF), inputTokens: 1, outputTokens: 1, modelId: 'm', stopReason: 'end_turn' };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { model: { complete } as unknown as ModelClient, complete };
}

describe('extractStructuredBrief — durable context', () => {
  it('threads durable context into the model user message', async () => {
    const cap: { userMessage?: string } = {};
    const { model } = mockModel(cap);
    await extractStructuredBrief({ planContent: { answers: { Q1: 'launch' }, freeNotes: '' }, planMonth: '2026-08', model, durableContext: ['[idea] provenance'] });
    expect(cap.userMessage).toContain('DURABLE CONTEXT');
    expect(cap.userMessage).toContain('[idea] provenance');
  });

  it('still extracts (a model call) when planContent is empty but durable context exists', async () => {
    const cap: { userMessage?: string } = {};
    const { model, complete } = mockModel(cap);
    await extractStructuredBrief({ planContent: { answers: {}, freeNotes: '' }, planMonth: '2026-08', model, durableContext: ['[next_cycle] relaunch'] });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(cap.userMessage).toContain('[next_cycle] relaunch');
  });

  it('returns EMPTY with NO model call when brief AND durable context are both empty', async () => {
    const { model, complete } = mockModel({});
    const r = await extractStructuredBrief({ planContent: { answers: {}, freeNotes: '' }, planMonth: '2026-08', model, durableContext: [] });
    expect(complete).not.toHaveBeenCalled();
    expect(r).toEqual(EMPTY_STRUCTURED_BRIEF);
  });
});
