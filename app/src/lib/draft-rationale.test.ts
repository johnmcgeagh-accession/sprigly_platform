/**
 * draft-rationale.test.ts — rationales are computed evidence, never narration.
 *
 * The assertions that matter here are the NEGATIVE ones: that a missing field produces a
 * shorter sentence rather than an invented one, and that a beat with nothing to say says
 * nothing. A rationale the evidence does not support is the one failure mode that would
 * cost the client's trust in every other rationale on the page.
 */
import { describe, it, expect } from 'vitest';
import { rationaleFor, slotLabel, assumptionPrompt } from '@/lib/draft-rationale';
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
