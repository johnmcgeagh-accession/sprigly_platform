import { describe, it, expect } from 'vitest';
import { classifyIntake, routeFromParsed, parseClassification, type ClassifyParams } from './intake-classify.js';
import type { ModelClient } from './types.js';

const stub = (reply: string | (() => string)): ModelClient => ({
  complete: async () => ({
    content: typeof reply === 'function' ? reply() : reply,
    inputTokens: 1, outputTokens: 1, modelId: 'stub', stopReason: 'end_turn',
  }),
});

const classify = (reply: string | (() => string), text = 'some input', over: Partial<ClassifyParams> = {}) =>
  classifyIntake({ text, planMonth: '2026-09', model: stub(reply), ...over });

const monthScoped = (intent: Record<string, unknown>) => JSON.stringify({ scope: 'month_scoped', intent });

describe('routeFromParsed — the validation gate', () => {
  it('accepts a well-formed launch intent', () => {
    const r = routeFromParsed({
      scope: 'month_scoped',
      intent: { kind: 'launch', subject: 'the navy edit', sourceText: 'x', dateRange: { start: '2026-09-28', end: '2026-09-28' } },
    }, 'The navy edit drops on the 28th');
    expect(r.scope).toBe('month_scoped');
    if (r.scope === 'month_scoped') {
      expect(r.intent.kind).toBe('launch');
      // Provenance is ours, never the model's: sourceText is overwritten with what we
      // actually received, so a receipt can't quote words the client never sent.
      expect(r.intent.sourceText).toBe('The navy edit drops on the 28th');
    }
  });

  it('accepts an explicit evergreen verdict', () => {
    const r = routeFromParsed({ scope: 'evergreen' }, 'we should do more BTS');
    expect(r).toMatchObject({ scope: 'evergreen', reason: 'classified_evergreen' });
  });

  // ── Every failure lands on evergreen. This is the contract. ──────────────────
  it.each([
    ['a malformed envelope',        { nonsense: true }],
    ['an unknown scope',            { scope: 'maybe' }],
    ['month_scoped with no intent', { scope: 'month_scoped' }],
    ['month_scoped with null intent', { scope: 'month_scoped', intent: null }],
    ['an unknown intent kind',      { scope: 'month_scoped', intent: { kind: 'vibes', subject: 'x', sourceText: 'x' } }],
    ['an intent missing subject',   { scope: 'month_scoped', intent: { kind: 'event', sourceText: 'x' } }],
    ['a malformed date',            { scope: 'month_scoped', intent: { kind: 'event', subject: 'x', sourceText: 'x', dateRange: { start: '28th Sept', end: '28th Sept' } } }],
  ])('routes %s to evergreen as validation_failed', (_label, parsed) => {
    expect(routeFromParsed(parsed, 'src')).toMatchObject({ scope: 'evergreen', reason: 'validation_failed' });
  });

  it('routes a launch with NO date to evergreen — an arc needs an anchor', () => {
    const r = routeFromParsed({ scope: 'month_scoped', intent: { kind: 'launch', subject: 'the navy edit', sourceText: 'x' } }, 'src');
    expect(r).toMatchObject({ scope: 'evergreen', reason: 'ambiguous' });
  });

  it('routes an incomplete beat_edit to evergreen rather than guessing', () => {
    // "change the Friday one" — which change?
    expect(routeFromParsed({ scope: 'month_scoped', intent: { kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel' } }, 'src'))
      .toMatchObject({ scope: 'evergreen', reason: 'ambiguous' });
    // "move it" — move what?
    expect(routeFromParsed({ scope: 'month_scoped', intent: { kind: 'beat_edit', subject: 'x', sourceText: 'x', edit: 'move' } }, 'src'))
      .toMatchObject({ scope: 'evergreen', reason: 'ambiguous' });
  });

  it('accepts emphasis without a date — emphasis needs no anchor', () => {
    const r = routeFromParsed({ scope: 'month_scoped', intent: { kind: 'emphasis', subject: 'more product', sourceText: 'x', emphasis: 'Product & Fragrance' } }, 'src');
    expect(r.scope).toBe('month_scoped');
  });
});

describe('parseClassification', () => {
  it('parses bare JSON, fenced JSON and prose-wrapped JSON alike', () => {
    const body = '{"scope":"evergreen"}';
    expect(parseClassification(body)).toEqual({ scope: 'evergreen' });
    expect(parseClassification('```json\n' + body + '\n```')).toEqual({ scope: 'evergreen' });
    expect(parseClassification('Sure! ' + body + ' Hope that helps.')).toEqual({ scope: 'evergreen' });
  });

  it('throws on genuinely unparseable output (the caller converts this to evergreen)', () => {
    expect(() => parseClassification('no json here at all')).toThrow();
  });
});

describe('classifyIntake — end to end, never throws', () => {
  it('routes a dated launch as month-scoped', async () => {
    const r = await classify(monthScoped({
      kind: 'launch', subject: 'the navy edit', sourceText: 'ignored',
      dateRange: { start: '2026-09-28', end: '2026-09-28' },
    }), 'The navy edit drops on the 28th');
    expect(r.scope).toBe('month_scoped');
  });

  it('routes a standing idea as evergreen', async () => {
    const r = await classify('{"scope":"evergreen"}', 'we should do more behind the scenes');
    expect(r).toMatchObject({ scope: 'evergreen', reason: 'classified_evergreen' });
  });

  it('falls back to evergreen when the model returns junk', async () => {
    expect(await classify('not json at all')).toMatchObject({ scope: 'evergreen', reason: 'validation_failed' });
  });

  it('falls back to evergreen when the model THROWS', async () => {
    const model: ModelClient = { complete: async () => { throw new Error('bedrock exploded'); } };
    const r = await classifyIntake({ text: 'anything', planMonth: '2026-09', model });
    expect(r).toMatchObject({ scope: 'evergreen', reason: 'model_error' });
  });

  it('routes empty input to evergreen without calling the model', async () => {
    let called = false;
    const model: ModelClient = { complete: async () => { called = true; throw new Error('should not be called'); } };
    const r = await classifyIntake({ text: '   ', planMonth: '2026-09', model });
    expect(called).toBe(false);
    expect(r.scope).toBe('evergreen');
  });

  it('an audit failure never changes the routing', async () => {
    const audit = { logModelCall: async () => { throw new Error('audit down'); } };
    const r = await classify(monthScoped({
      kind: 'event', subject: 'market stall', sourceText: 'x', dateRange: { start: '2026-09-12', end: '2026-09-12' },
    }), 'we have a market stall on the 12th', { audit: audit as never, clientId: 'c1' });
    expect(r.scope).toBe('month_scoped');
  });
});
