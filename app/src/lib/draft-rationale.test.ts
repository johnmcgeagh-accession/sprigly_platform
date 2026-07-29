/**
 * draft-rationale.test.ts — rationales are computed evidence, never narration.
 *
 * The assertions that matter here are the NEGATIVE ones: that a missing field produces a
 * shorter sentence rather than an invented one, and that a beat with nothing to say says
 * nothing. A rationale the evidence does not support is the one failure mode that would
 * cost the client's trust in every other rationale on the page.
 */
import { describe, it, expect } from 'vitest';
import { rationaleFor, slotLabel, assumptionPrompt, isAnswerable, firstAnswerable } from '@/lib/draft-rationale';
import type { BeatEvidence } from '@/lib/types';

describe('rationaleFor — observed evidence', () => {
  // The real shape from Build A's Earl of East sample.
  const observed: BeatEvidence = {
    basis: 'observed',
    formatEngagement: { format: 'carousel', avgEngagement: 69.9, posts: 8 },
    pillarShare: 0.2,
    cadenceBasis: { postsPerWeek: 2.24, source: 'observed', months: 4 },
  };

  it('reads the real numbers back, including the sample size', () => {
    const out = rationaleFor(observed, 'Brand Story & Culture');
    expect(out).toBe('Carousels average 70 likes and comments across your last 8 posts; Brand Story & Culture is about 20% of what you post.');
  });

  it('states the sample size so the client can judge it — n=8 is not hidden', () => {
    expect(rationaleFor(observed, 'Brand Story & Culture')).toContain('8 posts');
  });

  it('drops the format clause when there is no engagement evidence', () => {
    const { formatEngagement: _drop, ...noFormat } = observed;
    const out = rationaleFor(noFormat as BeatEvidence, 'Everyday Ritual');
    expect(out).toBe('Everyday Ritual is about 20% of what you post.');
    expect(out).not.toMatch(/average/);
  });

  it('drops the pillar clause when there is no share', () => {
    const { pillarShare: _drop, ...noShare } = observed;
    expect(rationaleFor(noShare as BeatEvidence, 'Everyday Ritual')).toBe('Carousels average 70 likes and comments across your last 8 posts.');
  });

  it('says NOTHING when observed evidence is empty — silence over a hedge', () => {
    expect(rationaleFor({ basis: 'observed' }, 'Everyday Ritual')).toBe('');
  });

  it('does not claim a pillar share of zero', () => {
    expect(rationaleFor({ basis: 'observed', pillarShare: 0 }, 'Everyday Ritual')).toBe('');
  });

  it('does not cite a format measured over zero posts', () => {
    const zero: BeatEvidence = { basis: 'observed', formatEngagement: { format: 'reel', avgEngagement: 0, posts: 0 } };
    expect(rationaleFor(zero, 'Everyday Ritual')).toBe('');
  });

  it('names an experiment’s source', () => {
    const client: BeatEvidence = { basis: 'observed', candidateRank: { rank: 1, of: 3, origin: 'client' } };
    expect(rationaleFor(client, 'x')).toBe('This came from an idea you sent us.');
    const competitor: BeatEvidence = { basis: 'observed', candidateRank: { rank: 1, of: 3, origin: 'competitor' } };
    expect(rationaleFor(competitor, 'x')).toBe('This came from something working for a competitor.');
  });

  it('pluralises a single post correctly', () => {
    const one: BeatEvidence = { basis: 'observed', formatEngagement: { format: 'reel', avgEngagement: 12, posts: 1 } };
    expect(rationaleFor(one, 'x')).toContain('last 1 post.');
  });
});

describe('rationaleFor — template fallback', () => {
  it('names the gap instead of implying a pattern it did not observe', () => {
    const out = rationaleFor({ basis: 'template', reason: 'insufficient history: 9 posts, floor is 15' }, 'Everyday Ritual');
    expect(out).toMatch(/don’t have enough of your posting history/);
    expect(out).not.toMatch(/average|%|likes/);   // no numbers it never measured
  });
});

describe('rationaleFor — client_added', () => {
  it('credits the client and claims nothing else', () => {
    const out = rationaleFor({ basis: 'client_added' }, 'Home & Space');
    expect(out).toBe('You added this one.');
    expect(out).not.toMatch(/average|%|working/);
  });
});

describe('rationaleFor — client_input (gap 4)', () => {
  it('quotes the client’s own sentence back — the strongest reason in the system', () => {
    const said = 'The Wilderness candle relaunches on the 24th, can we build up to it?';
    expect(rationaleFor({ basis: 'client_input', reason: said }, 'Home & Space'))
      .toBe(`From what you told us: “${said}”`);
  });

  it('claims nothing about the feed — this branch has no metrics and invents none', () => {
    const out = rationaleFor({ basis: 'client_input', reason: 'a mini-series, one post every three weeks' }, 'Understands Real Women');
    expect(out).not.toMatch(/average|%|likes|history/);
  });

  it('says NOTHING when the text was not recorded, rather than reaching for a sentence', () => {
    expect(rationaleFor({ basis: 'client_input' }, 'x')).toBe('');
    expect(rationaleFor({ basis: 'client_input', reason: '   ' }, 'x')).toBe('');
  });

  it('trims a long segment at a word boundary, never mid-word', () => {
    // ivy-t's briefs contain 200-character segments; a card has two lines.
    const long = '15th August — our factory in Portugal starts its annual summer shutdown until 7th September, '
      + 'so everything ordered after the 12th ships when they are back and we should say so clearly';
    const out = rationaleFor({ basis: 'client_input', reason: long }, 'x');

    expect(out.length).toBeLessThan(long.length);
    expect(out).toMatch(/…”$/);
    const quoted = out.slice(out.indexOf('“') + 1, -2);
    // Every word kept is a whole word from the original.
    expect(long.startsWith(quoted)).toBe(true);
    expect(long[quoted.length] === ' ' || long[quoted.length] === undefined).toBe(true);
  });

  it('collapses whitespace so a pasted brief does not render its own line breaks', () => {
    expect(rationaleFor({ basis: 'client_input', reason: 'one\n\n  two' }, 'x'))
      .toBe('From what you told us: “one two”');
  });
});

describe('rationaleFor — emphasis_reweight', () => {
  it('cites the client’s words and NEVER the old pillar’s share', () => {
    const out = rationaleFor({ basis: 'emphasis_reweight', reason: 'more product this month' }, 'Product & Fragrance');
    expect(out).toBe('Leaned this way because you said: \u201Cmore product this month\u201D.');
    // The whole point of the correction: no percentage, no engagement, no old pillar.
    expect(out).not.toMatch(/%|average|likes|Everyday Ritual/);
  });

  it('degrades gracefully when the source text is missing', () => {
    expect(rationaleFor({ basis: 'emphasis_reweight' }, 'x')).toBe('You asked us to lean the month this way.');
  });
});

describe('slotLabel', () => {
  it('labels an experiment so a bet is distinguishable from a safe pick', () => {
    expect(slotLabel('experiment')).toBe('Something new');
  });
  it('leaves a proven slot unlabelled — the default needs no badge', () => {
    expect(slotLabel('proven')).toBeNull();
  });
});

describe('isAnswerable / firstAnswerable', () => {
  const LAUNCHES = 'no launches or restocks are on record for this month';
  const FORMATS  = 'the format mix is based on posts whose format we could not read';

  it('keeps a gap in what we know about THEIR month', () => {
    expect(isAnswerable(LAUNCHES)).toBe(true);
    expect(isAnswerable('no specific products from the catalogue were named')).toBe(true);
    expect(isAnswerable('the month is split evenly across pillars')).toBe(true);
  });

  it('drops a fact about OUR data — a client can do nothing with it', () => {
    // Asking them about this asks them to fix our bookkeeping.
    expect(isAnswerable(FORMATS)).toBe(false);
  });

  it('surfaces exactly one, in the assembler’s order', () => {
    expect(firstAnswerable([FORMATS, LAUNCHES])).toBe(LAUNCHES);
    expect(firstAnswerable([LAUNCHES, 'no specific products from the catalogue were named'])).toBe(LAUNCHES);
  });

  it('says nothing when everything on the list is ours', () => {
    expect(firstAnswerable([FORMATS])).toBeNull();
    expect(firstAnswerable([])).toBeNull();
  });

  it('treats an UNKNOWN assumption as answerable — the failure modes are asymmetric', () => {
    // A needless question costs a tap; a suppressed one costs a month.
    expect(isAnswerable('something the assembler has not flagged before')).toBe(true);
  });
});

describe('assumptionPrompt', () => {
  it.each([
    ['No launches or restocks are on record for this month — the draft assumes a business-as-usual month.', /anything coming up/i],
    ['No product catalogue is cached, so no beat names a specific product or colourway.', /particular ones featured/i],
    ['Not enough posting history to plan from (9 posts, 15 needed) — this month uses a neutral starting shape.', /limited history/i],
    ['Format mix is based on 19 of 50 posts — the rest predate format tracking.', /best guess/i],
    ['No pillar weights are on record, so the month splits evenly across pillars.', /weight it differently/i],
  ])('turns a known assumption into a question', (assumption, expected) => {
    expect(assumptionPrompt(assumption)).toMatch(expected);
  });

  it('shows an unrecognised assumption verbatim rather than guessing a question for it', () => {
    const odd = 'Something the assembler flagged that this file has never seen.';
    expect(assumptionPrompt(odd)).toBe(odd);
  });
});
