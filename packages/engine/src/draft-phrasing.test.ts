import { describe, it, expect } from 'vitest';
import {
  phraseDraftTitles, applyPhrasing, parsePhrasing, validatePhrasing, isTitleFixed,
  PHRASING_SYSTEM, type PhrasingModel, type PhrasingVocabulary,
} from './draft-phrasing.js';
import { seriesMatchTerms } from './draft-recurring.js';
import type { DraftBeat } from './draft-assembly.js';
import type { BeatRationaleEvidence } from '@sprigly/db';

const beat = (position: number, pillar: string, evidence: Partial<BeatRationaleEvidence> = {}): DraftBeat => ({
  scheduledDate: `2026-09-${String(position + 1).padStart(2, '0')}`,
  format: 'carousel', pillar, position,
  title: `${pillar} — Carousel`,
  beatMeta: {
    slotType: 'proven',
    rationaleEvidence: {
      basis: 'observed', pillarShare: 0.5,
      formatEngagement: { format: 'carousel', avgEngagement: 31.9, posts: 86 },
      cadenceBasis: { postsPerWeek: 3, source: 'observed', months: 2 },
      ...evidence,
    },
  },
});

/** An experiment slot the client's own idea filled — its title is theirs, verbatim. */
const fixedBeat = (position: number, title: string): DraftBeat => ({
  scheduledDate: `2026-09-${String(position + 1).padStart(2, '0')}`,
  format: 'reel', pillar: 'Everyday Ritual', position, title,
  beatMeta: {
    slotType: 'experiment',
    sourceRef: 'plan-input-1',
    rationaleEvidence: { basis: 'observed', candidateRank: { rank: 1, of: 6, origin: 'client' } },
  },
});

const BEATS = [beat(0, 'Everyday Ritual'), beat(1, 'Brand Story')];

/** ivy-t's real vocabulary shape: multi-word series, a bracketed expansion, real names. */
const VOCAB: PhrasingVocabulary = {
  productNames: ['Hannah', 'Jules', 'Connie'],
  seriesNames:  ['Sunday Style', 'WSG (Weekend Style Guide)'],
};

const titles = (...v: string[]) => new Map(v.map((t, i) => [i, t]));

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

  // Same salvage, same blind spot — see json-salvage.ts. Pinned here so this parser cannot
  // regress to first-object-wins independently of the one the bug was found on.
  it('takes the LAST object when the model self-corrects', () => {
    const raw = '{"titles":[{"position":0,"title":"First go"}]}\n\nOn reflection:\n\n'
              + '{"titles":[{"position":0,"title":"Better go"}]}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parsePhrasing(raw).get(0)).toBe('Better go');
  });

  it('falls back to the last COMPLETE object when the correction is truncated', () => {
    const raw = '{"titles":[{"position":0,"title":"First go"}]}\n\nOn reflection:\n\n{"titles":[{"pos';
    expect(parsePhrasing(raw).get(0)).toBe('First go');
  });
});

describe('validatePhrasing — the model may only restate its evidence', () => {
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

// ── The per-beat licence: a name is allowed by THIS beat's evidence or not at all ──────

describe('validatePhrasing — a product may be named only by the beat that carries it', () => {
  const coverage = (product: string, lastFeatured: string | null, mentions: number) =>
    beat(0, 'Everyday Ritual', { productCoverage: { product, lastFeatured, mentions } });

  it('accepts the product THIS beat is about', () => {
    const beats = [coverage('Jules', '2026-02-03', 5), beat(1, 'Brand Story')];
    const t = new Map([[0, 'Jules, back in the rotation'], [1, 'Where it all started']]);
    expect(validatePhrasing(beats, t, VOCAB)).toBeNull();
  });

  it('accepts a never-featured product — absence of a date is still evidence', () => {
    const beats = [coverage('Jules', null, 0)];
    expect(validatePhrasing(beats, new Map([[0, 'Meet Jules']]), VOCAB)).toBeNull();
  });

  it('rejects a DIFFERENT product from the one the beat carries', () => {
    const beats = [coverage('Jules', '2026-02-03', 5)];
    expect(validatePhrasing(beats, new Map([[0, 'Styling the Hannah tee']]), VOCAB))
      .toMatch(/named "Hannah", but its evidence is for "Jules"/);
  });

  it('rejects ANY product on a beat that carries none — the blanket ban still holds there', () => {
    expect(validatePhrasing(BEATS, titles('Three ways with Connie', 'Where it all started'), VOCAB))
      .toMatch(/named product "Connie", which is not in its evidence/);
  });

  it('is case-insensitive about the name — "connie" is still naming Connie', () => {
    expect(validatePhrasing(BEATS, titles('three ways with connie', 'x'), VOCAB)).not.toBeNull();
  });

  it('does not police a name absent from the vocabulary', () => {
    // "Joy" is a real ivy-t product AND a word she writes in four captions. The caller
    // excludes it (draft-plan.ts); the validator must then leave it entirely alone.
    expect(validatePhrasing(BEATS, titles('Pure joy, every morning', 'x'), VOCAB)).toBeNull();
  });

  it('does not fire on a name embedded in a longer word', () => {
    expect(validatePhrasing(BEATS, titles('Connieish is not a word', 'x'), VOCAB)).toBeNull();
  });

  it('policing is inert when no vocabulary is supplied', () => {
    expect(validatePhrasing(BEATS, titles('Three ways with Connie', 'x'))).toBeNull();
  });
});

describe('validatePhrasing — series names follow the same per-beat rule', () => {
  const withSeries = (name: string) => beat(0, 'Everyday Ritual', {
    seriesDue: { name, dayOfWeek: 'Sunday', lastPlanned: '2026-07-19', monthsObserved: 2 },
  });

  it('accepts the series THIS beat is an instance of', () => {
    expect(validatePhrasing([withSeries('Sunday Style')], new Map([[0, 'Sunday Style: soft layers']]), VOCAB)).toBeNull();
  });

  it('accepts either side of a bracketed configured name', () => {
    const beats = [withSeries('WSG (Weekend Style Guide)')];
    expect(validatePhrasing(beats, new Map([[0, 'WSG: two easy looks']]), VOCAB)).toBeNull();
    expect(validatePhrasing(beats, new Map([[0, 'The Weekend Style Guide, simplified']]), VOCAB)).toBeNull();
  });

  it('rejects a series on a beat that carries none', () => {
    expect(validatePhrasing(BEATS, titles('Sunday Style, made simple', 'x'), VOCAB))
      .toMatch(/named series "Sunday Style", which is not in its evidence/);
  });

  it('rejects the WRONG series on a beat that carries a different one', () => {
    expect(validatePhrasing([withSeries('Sunday Style')], new Map([[0, 'WSG: two easy looks']]), VOCAB))
      .toMatch(/named series "WSG \(Weekend Style Guide\)", but its evidence is for "Sunday Style"/);
  });
});

describe('seriesMatchTerms', () => {
  it('expands a bracketed configured name into both of its forms', () => {
    expect(seriesMatchTerms('WSG (Weekend Style Guide)').sort())
      .toEqual(['WSG', 'WSG (Weekend Style Guide)', 'Weekend Style Guide'].sort());
  });

  it('leaves a plain name alone', () => {
    expect(seriesMatchTerms('Sunday Style')).toEqual(['Sunday Style']);
  });

  it('orders longest first, deterministically', () => {
    expect(seriesMatchTerms('WSG (Weekend Style Guide)')[0]).toBe('WSG (Weekend Style Guide)');
  });
});

describe('the outright bans survive the widening', () => {
  // September's structured_brief is NULL, so no beat carries evidence for a date, a launch
  // or a price. There is nothing to relax these against and they stay unconditional.
  it.each([
    ['a launch',   'Jules launches this month'],
    ['a date',     'Jules on the 28th'],
    ['a month',    'Jules in September'],
    ['a metric',   'Jules, up 40%'],
    ['a price',    'Jules, now £30'],
  ])('still rejects %s even on a beat that legitimately names its product', (_label, badTitle) => {
    const beats = [beat(0, 'Everyday Ritual', { productCoverage: { product: 'Jules', lastFeatured: null, mentions: 0 } })];
    expect(validatePhrasing(beats, new Map([[0, badTitle]]), VOCAB)).not.toBeNull();
  });
});

describe('isTitleFixed — the client\'s own words are never paraphrased', () => {
  it('is true for a client-origin experiment slot', () => {
    expect(isTitleFixed(fixedBeat(0, 'Why never to wear polyester — Reel'))).toBe(true);
  });

  it('is false for a competitor-origin experiment slot', () => {
    const b = fixedBeat(0, 'x');
    b.beatMeta.rationaleEvidence.candidateRank!.origin = 'competitor';
    expect(isTitleFixed(b)).toBe(false);
  });

  it('is false for an ordinary proven beat', () => {
    expect(isTitleFixed(BEATS[0]!)).toBe(false);
  });

  it('does not require a title for a fixed beat', () => {
    const beats = [beat(0, 'Everyday Ritual'), fixedBeat(1, 'Her own sentence')];
    expect(validatePhrasing(beats, new Map([[0, 'A fine title']]))).toBeNull();
  });

  it('never replaces a fixed title, even when the model returns one', () => {
    const beats = [beat(0, 'Everyday Ritual'), fixedBeat(1, 'Her own sentence')];
    const out = applyPhrasing(beats, { titles: new Map([[0, 'New'], [1, 'Model rewrite']]), outcome: 'phrased' });
    expect(out[0]!.title).toBe('New');
    expect(out[1]!.title).toBe('Her own sentence');
  });

  it('does not call the model when every beat is fixed', async () => {
    let called = false;
    const model: PhrasingModel = { complete: async () => { called = true; throw new Error('should not be called'); } };
    const res = await phraseDraftTitles({ beats: [fixedBeat(0, 'Hers')], voiceSummary: null, model });
    expect(called).toBe(false);
    expect(res.outcome).toBe('phrased');
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

// ── The prompt itself: A's whole point is that the evidence travels ────────────────────

describe('the prompt carries the evidence the beat already holds', () => {
  /** Capture the user message the pass would send. */
  const capture = async (beats: DraftBeat[], voice: string | null = null): Promise<string> => {
    let seen = '';
    const model: PhrasingModel = {
      complete: async (p) => {
        seen = p.messages[0]!.content;
        return {
          content: JSON.stringify({ titles: beats.filter((b) => !isTitleFixed(b)).map((b) => ({ position: b.position, title: 'ok' })) }),
          inputTokens: 1, outputTokens: 1, modelId: 'stub',
        };
      },
    };
    await phraseDraftTitles({ beats, voiceSummary: voice, model });
    return seen;
  };

  it('states format engagement WITH its sample size', async () => {
    // The regression this guards: a figure travelling without the n behind it invites the
    // model to treat n=1 and n=86 as the same claim.
    const msg = await capture(BEATS);
    expect(msg).toContain('carousels average 31.9 likes+comments over 86 posts');
  });

  it('states cadence and its source', async () => {
    expect(await capture(BEATS)).toContain('cadence 3/week (observed, 2 months)');
  });

  it('states pillar share', async () => {
    expect(await capture(BEATS)).toContain('this pillar is 50% of their posting');
  });

  it('names the beat\'s product, its coverage gap, and the licence to use it', async () => {
    const beats = [beat(0, 'Everyday Ritual', { productCoverage: { product: 'Jules', lastFeatured: '2026-02-03', mentions: 5 } })];
    const msg = await capture(beats);
    expect(msg).toContain('PRODUCT "Jules" — you may name it, spelled exactly');
    expect(msg).toContain('last in a caption on 2026-02-03, 5 captions in all');
  });

  it('says NEVER APPEARED rather than a zero date for an unfeatured product', async () => {
    const beats = [beat(0, 'Everyday Ritual', { productCoverage: { product: 'Bea', lastFeatured: null, mentions: 0 } })];
    const msg = await capture(beats);
    expect(msg).toContain('never appeared in a caption');
    expect(msg).not.toMatch(/1970|0000|last in a caption/);
  });

  it('names the beat\'s series, its day, and when it last ran', async () => {
    const beats = [beat(0, 'Everyday Ritual', {
      seriesDue: { name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-19', monthsObserved: 2 },
    })];
    const msg = await capture(beats);
    expect(msg).toContain('SERIES "Sunday Style" (Sunday) — you may name it');
    expect(msg).toContain('last planned 2026-07-19, seen in 2 months');
  });

  it('marks a fixed-title beat KEEP AS IS and quotes it, but does not ask for a title', async () => {
    const beats = [beat(0, 'Everyday Ritual'), fixedBeat(1, 'Why never to wear polyester')];
    const msg = await capture(beats);
    expect(msg).toContain('position 1: KEEP AS IS — the client\'s own words: "Why never to wear polyester"');
    expect(msg).toContain('Write one title for each of the 1 positions above that is NOT marked KEEP AS IS');
  });

  it('keeps a template beat plain and says why, rather than inventing a metric', async () => {
    const templateBeat: DraftBeat = {
      scheduledDate: '2026-09-01', format: 'carousel', pillar: 'Everyday Ritual', position: 0,
      title: 'Everyday Ritual — Carousel',
      beatMeta: {
        slotType: 'proven',
        rationaleEvidence: {
          basis: 'template', reason: 'insufficient history: 9 posts, floor is 15',
          cadenceBasis: { postsPerWeek: 3, source: 'config', months: 1 },
        },
      },
    };
    const msg = await capture([templateBeat]);
    expect(msg).toContain('no history to draw on (insufficient history: 9 posts, floor is 15) — keep this title plain');
    expect(msg).not.toContain('likes+comments');
  });

  it('labels an experiment slot as one', async () => {
    const b = beat(0, 'Everyday Ritual');
    b.beatMeta.slotType = 'experiment';
    expect(await capture([b])).toContain('this is an experiment slot, not a proven one');
  });
});

describe('PHRASING_SYSTEM states the per-beat licence, not a blanket allow', () => {
  it('permits only the product THAT BEAT names', () => {
    expect(PHRASING_SYSTEM).toContain('you may NOT name a product on a beat that gives you none');
  });

  it('keeps the date, launch and metric bans unconditional', () => {
    expect(PHRASING_SYSTEM).toMatch(/NEVER promise a launch, a restock, a sale, an offer, or an event, and never name a date or a month/);
    expect(PHRASING_SYSTEM).toMatch(/NEVER state a metric, a number, a percentage, or a performance claim/);
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
