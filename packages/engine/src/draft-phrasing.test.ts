import { describe, it, expect } from 'vitest';
import { phraseDraftTitles, applyPhrasing, parsePhrasing, validatePhrasing, type PhrasingModel } from './draft-phrasing.js';
import type { DraftBeat } from './draft-assembly.js';

const beat = (position: number, pillar: string): DraftBeat => ({
  scheduledDate: `2026-09-${String(position + 1).padStart(2, '0')}`,
  format: 'carousel', pillar, position,
  title: `${pillar} — Carousel`,
  beatMeta: {
    slotType: 'proven',
    rationaleEvidence: { basis: 'observed', pillarShare: 0.5, cadenceBasis: { postsPerWeek: 3, source: 'observed', months: 2 } },
  },
});

const BEATS = [beat(0, 'Everyday Ritual'), beat(1, 'Brand Story')];

const stubModel = (reply: string | (() => string)): PhrasingModel => ({
  complete: async () => ({
    content: typeof reply === 'function' ? reply() : reply,
    inputTokens: 1, outputTokens: 1, modelId: 'stub',
  }),
});

const okReply = JSON.stringify({ titles: [
  { position: 0, title: 'The slow morning edit' },
  { position: 1, title: 'Where it all started' },
] });

describe('parsePhrasing', () => {
  it('parses a clean response', () => {
    expect(parsePhrasing(okReply).get(0)).toBe('The slow morning edit');
  });

  it('tolerates code fences and surrounding prose', () => {
    expect(parsePhrasing('Sure!\n```json\n' + okReply + '\n```\nHope that helps').get(1)).toBe('Where it all started');
  });

  it('throws on a response with no titles array', () => {
    expect(() => parsePhrasing('{"nope":true}')).toThrow(/titles/);
  });
});

describe('validatePhrasing — the model may only restate its evidence', () => {
  const titles = (...v: string[]) => new Map(v.map((t, i) => [i, t]));

  it('accepts plain, evidence-bounded titles', () => {
    expect(validatePhrasing(BEATS, titles('The slow morning edit', 'Where it all started'))).toBeNull();
  });

  it('rejects a missing beat — every beat must be phrased', () => {
    expect(validatePhrasing(BEATS, new Map([[0, 'Only one']]))).toMatch(/beat 1 was not phrased/);
  });

  it.each([
    ['an invented launch',    'The new collection launches'],
    ['an invented restock',   'Our bestseller is back in stock'],
    ['a fabricated metric',   'The post that got 40% more saves'],
    ['a price',              'Everything under £30'],
    ['a specific date',      'What to expect on the 28th'],
    ['a month',              'Everything new in September'],
    ['a performance claim',  'Our top-performing format'],
  ])('rejects %s', (_label, badTitle) => {
    expect(validatePhrasing(BEATS, titles(badTitle, 'Where it all started'))).toMatch(/introduced content not in its evidence/);
  });

  it('rejects the WHOLE batch when one title over-reaches', () => {
    // A model that invented a launch for beat 1 was not reasoning within evidence for
    // beat 0 either — taking the "good" one would be output we have no basis to trust.
    expect(validatePhrasing(BEATS, titles('A perfectly fine title', 'The autumn launch'))).not.toBeNull();
  });
});

describe('phraseDraftTitles — never blocks draft assembly', () => {
  it('returns phrased titles on a valid response', async () => {
    const res = await phraseDraftTitles({ beats: BEATS, voiceSummary: 'Warm, plain-spoken.', model: stubModel(okReply) });
    expect(res.outcome).toBe('phrased');
    expect(res.titles.get(0)).toBe('The slow morning edit');
  });

  it('retries ONCE then falls back when the model keeps returning junk', async () => {
    let calls = 0;
    const model = stubModel(() => { calls++; return 'not json at all'; });
    const res = await phraseDraftTitles({ beats: BEATS, voiceSummary: null, model });
    expect(calls).toBe(2);                       // one retry, not more
    expect(res.outcome).toBe('fallback');
  });

  it('recovers on the retry when the first attempt is malformed', async () => {
    let calls = 0;
    const model = stubModel(() => (++calls === 1 ? 'broken' : okReply));
    const res = await phraseDraftTitles({ beats: BEATS, voiceSummary: null, model });
    expect(res.outcome).toBe('phrased');
    expect(calls).toBe(2);
  });

  it('falls back rather than accepting invented content', async () => {
    const bad = JSON.stringify({ titles: [
      { position: 0, title: 'The autumn collection launches' },
      { position: 1, title: 'Where it all started' },
    ] });
    const res = await phraseDraftTitles({ beats: BEATS, voiceSummary: null, model: stubModel(bad) });
    expect(res.outcome).toBe('fallback');
    expect(res.reason).toMatch(/introduced content/);
  });

  it('never throws when the model itself throws', async () => {
    const model: PhrasingModel = { complete: async () => { throw new Error('bedrock exploded'); } };
    const res = await phraseDraftTitles({ beats: BEATS, voiceSummary: null, model });
    expect(res.outcome).toBe('fallback');
    expect(res.reason).toMatch(/bedrock exploded/);
  });

  it('handles an empty draft without calling the model', async () => {
    let called = false;
    const model: PhrasingModel = { complete: async () => { called = true; throw new Error('should not be called'); } };
    const res = await phraseDraftTitles({ beats: [], voiceSummary: null, model });
    expect(called).toBe(false);
    expect(res.outcome).toBe('phrased');
  });
});

describe('applyPhrasing', () => {
  it('replaces titles when phrased', () => {
    const out = applyPhrasing(BEATS, { titles: new Map([[0, 'New title']]), outcome: 'phrased' });
    expect(out[0]!.title).toBe('New title');
    expect(out[1]!.title).toBe('Brand Story — Carousel');   // untouched beats keep theirs
  });

  it('keeps every deterministic title on fallback', () => {
    const out = applyPhrasing(BEATS, { titles: new Map(), outcome: 'fallback', reason: 'x' });
    expect(out).toEqual(BEATS);
    expect(out.every((b) => b.title.length > 0)).toBe(true);
  });
});
