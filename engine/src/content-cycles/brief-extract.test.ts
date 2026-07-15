/**
 * brief-extract test (Build 3, Part B) — durable cross-cycle context is threaded into the
 * extractor input as a section DISTINCT from this month's brief, and durable-only input still
 * extracts (no longer short-circuited to empty).
 */
import { describe, it, expect, vi } from 'vitest';
import { buildBriefExtractUserMessage, extractStructuredBrief, validateStructuredBrief, distributeBriefAnswers, EMPTY_STRUCTURED_BRIEF } from './brief-extract.js';
import type { ModelClient } from '@sprigly/model-client';

/** A structurally-valid brief with one supplied schedule beat — for gate tests. */
function briefWithBeat(beat: Record<string, unknown>) {
  return { products: [], schedule: [beat], content_asks: [], focus: [], conflicts: [], plan_window: { from: null, month: '2026-08' } };
}

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

// Build 6 — the extract-gate WIDENS to accept range beats but stays STRICT: a beat must set
// exactly one of date / dateRange, and a range must be two ISO dates with start <= end.
describe('validateStructuredBrief — schedule beats: single vs range (fail-loud gate)', () => {
  it('accepts a single-day beat (date set, dateRange null)', () => {
    const b = validateStructuredBrief(briefWithBeat({ date: '2026-08-25', dateRange: null, type: 'launch', product: null, colourway: null, note: 'the 25th' }));
    expect(b.schedule[0]).toMatchObject({ date: '2026-08-25', dateRange: null });
  });

  it('accepts a range beat (date null, dateRange set) and preserves the note phrasing', () => {
    const b = validateStructuredBrief(briefWithBeat({ date: null, dateRange: { start: '2026-08-25', end: '2026-08-31' }, type: 'sale', product: null, colourway: null, note: 'the last week of August' }));
    expect(b.schedule[0]).toMatchObject({ date: null, dateRange: { start: '2026-08-25', end: '2026-08-31' }, note: 'the last week of August' });
  });

  it('accepts a persisted pre-range beat (date only, dateRange key absent)', () => {
    const b = validateStructuredBrief(briefWithBeat({ date: '2026-08-10', type: 'feature', product: null, colourway: null, note: 'legacy' }));
    expect(b.schedule[0]).toMatchObject({ date: '2026-08-10', dateRange: null });
  });

  it('REJECTS a beat that sets BOTH date and dateRange', () => {
    expect(() => validateStructuredBrief(briefWithBeat({ date: '2026-08-25', dateRange: { start: '2026-08-25', end: '2026-08-31' }, type: 't', product: null, colourway: null, note: 'n' })))
      .toThrow(/must not set BOTH/);
  });

  it('REJECTS a beat that sets NEITHER date nor dateRange', () => {
    expect(() => validateStructuredBrief(briefWithBeat({ date: null, dateRange: null, type: 't', product: null, colourway: null, note: 'n' })))
      .toThrow(/must set EITHER/);
  });

  it('REJECTS a range whose start is after its end', () => {
    expect(() => validateStructuredBrief(briefWithBeat({ date: null, dateRange: { start: '2026-08-31', end: '2026-08-25' }, type: 't', product: null, colourway: null, note: 'n' })))
      .toThrow(/must not be after/);
  });

  it('REJECTS a range with a non-ISO endpoint', () => {
    expect(() => validateStructuredBrief(briefWithBeat({ date: null, dateRange: { start: '2026-08-25', end: 'soon' }, type: 't', product: null, colourway: null, note: 'n' })))
      .toThrow(/must be an ISO date/);
  });
});

// Prompt 2 — the freeform brief is distributed back into the base-question answer slots.
describe('distributeBriefAnswers', () => {
  const QS = ['Any key dates next month?', 'Anything new to feature?', 'Any looks or themes?'];

  function answerModel(json: string) {
    const complete = vi.fn(async () => ({ content: json, inputTokens: 1, outputTokens: 1, modelId: 'm', stopReason: 'end_turn' }));
    return { model: { complete } as unknown as ModelClient, complete };
  }

  it('keeps only exact-key questions the brief addresses (drops unknown keys + empties)', async () => {
    const { model } = answerModel(JSON.stringify({
      'Any key dates next month?': 'Launching Wren on the 25th',
      'Anything new to feature?': '   ',                 // empty → dropped
      'Some question we never asked': 'ignored',          // unknown key → dropped
    }));
    const out = await distributeBriefAnswers({ freeNotes: 'Launching Wren on the 25th.', questions: QS, model });
    expect(out).toEqual({ 'Any key dates next month?': 'Launching Wren on the 25th' });
  });

  it('returns {} with NO model call for empty text or no questions', async () => {
    const { model, complete } = answerModel('{}');
    expect(await distributeBriefAnswers({ freeNotes: '   ', questions: QS, model })).toEqual({});
    expect(await distributeBriefAnswers({ freeNotes: 'x', questions: [], model })).toEqual({});
    expect(complete).not.toHaveBeenCalled();
  });

  it('is non-fatal — a model/parse failure yields {} (free text is never lost upstream)', async () => {
    const model = { complete: vi.fn(async () => { throw new Error('boom'); }) } as unknown as ModelClient;
    expect(await distributeBriefAnswers({ freeNotes: 'anything', questions: QS, model })).toEqual({});
  });
});
