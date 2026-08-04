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

  it('falls back to evergreen when the model returns junk — as couldnt_apply after the retry', async () => {
    // Behaviour change: a failed extraction is now retried once, and a second failure is
    // reported as couldnt_apply rather than validation_failed, so the receipt can say we
    // could not apply it instead of implying the client asked for a filing. The
    // single-attempt contract is still pinned by routeFromParsed's own tests above.
    expect(await classify('not json at all')).toMatchObject({ scope: 'evergreen', reason: 'couldnt_apply' });
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

/**
 * ── A COSMETIC BOUND MUST NOT COST A WHOLE INPUT ─────────────────────────────────────
 *
 * The back-to-school brief classifies as an emphasis 10 times out of 10 and then writes a
 * 113–138 character phrase into a field capped at 120. Nine of ten overran, both attempts
 * overran the same way (the retry re-rolls the same distribution rather than fixing a
 * systematic overrun), and a correctly-read month-scoped input was lost to the backlog as
 * "Saved to your ideas" over four characters.
 *
 * `emphasis` is the ONLY field here that may be shortened, because it is the only one whose
 * consumer fails safe. The other three are pinned below as rejecting, by name, because each
 * would fail differently and worse.
 */
describe('emphasis shortens; every other bound still refuses', () => {
  const emphasisOf = async (value: string) => {
    const r = await classify(monthScoped({ kind: 'emphasis', subject: 'x', sourceText: 'x', emphasis: value }));
    return r.scope === 'month_scoped' ? r.intent.emphasis : `EVERGREEN/${(r as { reason: string }).reason}`;
  };

  it('THE LIVE CASE: a 124-character emphasis is no longer thrown away', async () => {
    const real = 'Back to school content should focus on the juggle of the school run and working life, tied to the new Karen range photoshoot';
    expect(real.length).toBe(124);
    const r = await classify(monthScoped({ kind: 'emphasis', subject: 'back to school', sourceText: 'x', emphasis: real }));
    expect(r.scope).toBe('month_scoped');
    expect(await emphasisOf(real)).toBe(real);       // 124 < 200 — it passes untouched now
  });

  it('shortens only past the bound, and leaves everything shorter exactly as sent', async () => {
    expect(await emphasisOf('Product & Fragrance')).toBe('Product & Fragrance');
    expect(await emphasisOf('x'.repeat(200))).toHaveLength(200);
  });

  it('cuts at a WORD boundary — a blind slice can manufacture a word nobody said', async () => {
    // Measured on the real output: `.slice(0, 120)` of the 124-character string above ends
    // "…Karen range photos", and `photos` is read downstream as a FORMAT instruction, which
    // would reformat a third of the month on a word the client never typed.
    const long = `${'a b c d e f g h i j '.repeat(10)}photoshoot`;   // 210 chars, ends mid-word at 200
    const got = await emphasisOf(long) as string;
    expect(got.length).toBeLessThanOrEqual(200);
    expect(got.endsWith('photo')).toBe(false);
    expect(got.endsWith('photos')).toBe(false);
    expect(long.startsWith(got)).toBe(true);          // a prefix, never a rewrite
    expect(got).toMatch(/\S$/);                        // no dangling whitespace
  });

  it('a single token longer than the bound leaves nothing, rather than a prefix of a word', async () => {
    // The consumer's own empty branch then says it could not tell what was meant, which is
    // honest. A 200-character prefix of one word is not a phrase and must not be matched on.
    expect(await emphasisOf('x'.repeat(260))).toBe('');
  });

  it('beatRef still REJECTS — it is a lookup key, and a short key is a wrong key', async () => {
    const r = await classify(monthScoped({
      kind: 'beat_edit', subject: 'x', sourceText: 'x', edit: 'drop', beatRef: 'y'.repeat(201),
    }));
    expect(r).toMatchObject({ scope: 'evergreen' });
  });

  it('correctionOf still REJECTS — dropping words WIDENS its match and moves more beats', async () => {
    const r = await classify(monthScoped({
      kind: 'correction', subject: 'x', sourceText: 'x', correctionOf: 'y'.repeat(201),
      dateRange: { start: '2026-09-10', end: '2026-09-10' },
    }));
    expect(r).toMatchObject({ scope: 'evergreen' });
  });

  it('editValue still REJECTS — it is compared for equality, and 10 characters is its real max', async () => {
    const r = await classify(monthScoped({
      kind: 'beat_edit', subject: 'x', sourceText: 'x', edit: 'swap_format', beatRef: 'the Friday reel',
      editValue: 'y'.repeat(65),
    }));
    expect(r).toMatchObject({ scope: 'evergreen' });
  });

  it('subject still REJECTS — it becomes a post’s title, and a truncated title is wrong, not short', async () => {
    const r = await classify(monthScoped({
      kind: 'event', subject: 'y'.repeat(201), sourceText: 'x', dateRange: { start: '2026-09-12', end: '2026-09-12' },
    }));
    expect(r).toMatchObject({ scope: 'evergreen' });
  });
});
