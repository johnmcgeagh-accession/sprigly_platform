/**
 * draft-rationale.test.ts — rationales are computed evidence, never narration.
 *
 * The assertions that matter here are the NEGATIVE ones: that a missing field produces a
 * shorter sentence rather than an invented one, and that a beat with nothing to say says
 * nothing. A rationale the evidence does not support is the one failure mode that would
 * cost the client's trust in every other rationale on the page.
 */
import { describe, it, expect } from 'vitest';
import { rationaleFor, groundingLines, monthSummary, slotLabel, assumptionPrompt, isAnswerable, firstAnswerable } from '@/lib/draft-rationale';
import type { BeatEvidence, DraftBeatView } from '@/lib/types';

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

  it('surfaces exactly one, and RANKS rather than taking the assembler’s order', () => {
    expect(firstAnswerable([FORMATS, LAUNCHES])).toBe(LAUNCHES);
    expect(firstAnswerable([LAUNCHES, 'no specific products from the catalogue were named'])).toBe(LAUNCHES);
  });

  it('resolves Earl of East’s LIVE pair the way spec §2 names it', () => {
    // Both of these are on the uat cycle right now, in this order. Both are answerable — "want
    // it weighted differently?" has a real transform behind it — so the ruling is about which
    // question is worth the one slot, not about which is a question.
    const live = [
      'No pillar weights are on record, so the month splits evenly across pillars.',
      'No launches or restocks are on record for this month — the draft assumes a business-as-usual month.',
    ];
    expect(firstAnswerable(live)).toBe(live[1]);
  });

  it('falls back to an unranked assumption rather than showing none', () => {
    expect(firstAnswerable(['something the assembler has not flagged before']))
      .toBe('something the assembler has not flagged before');
  });

  it('is stable within a rank — the assembler’s order is the tiebreak', () => {
    const a = 'no launches or restocks are on record (a)';
    const b = 'no launches or restocks are on record (b)';
    expect(firstAnswerable([a, b])).toBe(a);
    expect(firstAnswerable([b, a])).toBe(b);
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

describe('rationaleFor — a recurring series is a standing commitment, and leads', () => {
  const sundayStyle: BeatEvidence = {
    basis: 'observed',
    seriesDue: { name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-26', monthsObserved: 2 },
    formatEngagement: { format: 'carousel', avgEngagement: 31.9, posts: 86 },
    pillarShare: 0.14,
  };

  it('names the series, its day, and when it last ran', () => {
    expect(rationaleFor(sundayStyle, 'Simplify Your Morning'))
      .toContain('Sunday Style runs on Sundays; it last ran on 26 July');
  });

  it('states the sample behind the date', () => {
    expect(rationaleFor(sundayStyle, 'Simplify Your Morning'))
      .toContain('we’ve planned it in 2 of your recent months');
  });

  it('LEADS with the commitment, not with the feed metrics', () => {
    // A slot that exists because of a standing feature should open with the feature.
    expect(rationaleFor(sundayStyle, 'Simplify Your Morning').startsWith('Sunday Style')).toBe(true);
  });

  it('keeps the other clauses — the series does not displace them', () => {
    const out = rationaleFor(sundayStyle, 'Simplify Your Morning');
    expect(out).toContain('carousels average 32 likes and comments across your last 86 posts');
    expect(out).toContain('Simplify Your Morning is about 14% of what you post');
  });

  it('says a monthly series runs monthly rather than "on monthlys"', () => {
    const monthly: BeatEvidence = {
      basis: 'observed',
      seriesDue: { name: 'Notes from the Founder', dayOfWeek: 'monthly', lastPlanned: '2026-07-23', monthsObserved: 2 },
    };
    expect(rationaleFor(monthly, 'Born From Real Need')).toContain('Notes from the Founder runs monthly');
  });

  it('says a never-run series has NOT run, rather than reaching for a date', () => {
    const fresh: BeatEvidence = {
      basis: 'observed',
      seriesDue: { name: 'What our customers see', dayOfWeek: 'monthly', lastPlanned: null, monthsObserved: 0 },
    };
    const out = rationaleFor(fresh, 'Personal Relationships');
    expect(out).toContain('hasn’t run yet');
    expect(out).not.toMatch(/1970|Invalid|NaN|last ran/);
  });

  it('produces a shorter sentence, never "Invalid Date", on a malformed date', () => {
    const bad: BeatEvidence = {
      basis: 'observed',
      seriesDue: { name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: 'not-a-date', monthsObserved: 1 },
    };
    const out = rationaleFor(bad, 'x');
    expect(out).not.toContain('Invalid Date');
    expect(out).toContain('hasn’t run yet');
  });

  it('still says its piece on the THIN-HISTORY path — a commitment is not an inference', () => {
    const thin: BeatEvidence = {
      basis: 'template',
      reason: 'insufficient history: 9 posts, floor is 15',
      seriesDue: { name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-26', monthsObserved: 2 },
    };
    const out = rationaleFor(thin, 'x');
    expect(out).toContain('Sunday Style runs on Sundays');
    expect(out).toContain('don’t have enough of your posting history');
  });

  it('a template beat with no series is unchanged', () => {
    expect(rationaleFor({ basis: 'template' }, 'x'))
      .toBe('We don’t have enough of your posting history yet, so this is a starting shape rather than a pattern we’ve seen work.');
  });
});

describe('rationaleFor — a product gap is the one claim they can check in ten seconds', () => {
  const jules: BeatEvidence = {
    basis: 'observed',
    productCoverage: { product: 'Jules', lastFeatured: '2026-02-03', mentions: 5 },
    formatEngagement: { format: 'reel', avgEngagement: 42.1, posts: 183 },
  };

  it('names the product and the date they last posted about it', () => {
    expect(rationaleFor(jules, 'Stable Foundations'))
      .toContain('You haven’t posted about Jules since 3 February');
  });

  it('carries the sample the date came from', () => {
    expect(rationaleFor(jules, 'Stable Foundations')).toContain('(5 captions in the history we have)');
  });

  it('says NEVER FEATURED as its own claim, not as a missing date', () => {
    const bea: BeatEvidence = {
      basis: 'observed',
      productCoverage: { product: 'Bea', lastFeatured: null, mentions: 0 },
    };
    const out = rationaleFor(bea, 'Stable Foundations');
    expect(out).toContain('Bea hasn’t appeared in any of your captions');
    expect(out).not.toMatch(/since|1970|0 captions|Invalid/);
  });

  it('does not repeat a zero mention count after "hasn’t appeared"', () => {
    const bea: BeatEvidence = { basis: 'observed', productCoverage: { product: 'Bea', lastFeatured: null, mentions: 0 } };
    expect(rationaleFor(bea, 'x')).not.toContain('0 caption');
  });

  it('degrades to a shorter sentence, never "Invalid Date", on a malformed date', () => {
    const bad: BeatEvidence = { basis: 'observed', productCoverage: { product: 'Jules', lastFeatured: 'nope', mentions: 2 } };
    expect(rationaleFor(bad, 'x')).toContain('Jules hasn’t appeared in your captions for a while');
  });

  it('reads the series and the product together on a "Sunday Style: Bea" beat', () => {
    const both: BeatEvidence = {
      basis: 'observed',
      seriesDue: { name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-26', monthsObserved: 2 },
      productCoverage: { product: 'Bea', lastFeatured: null, mentions: 0 },
    };
    const out = rationaleFor(both, 'Simplify Your Morning');
    expect(out.startsWith('Sunday Style runs on Sundays')).toBe(true);
    expect(out).toContain('Bea hasn’t appeared in any of your captions');
  });

  it('still says its piece on the THIN-HISTORY path — a caption date is not an inference', () => {
    const thin: BeatEvidence = {
      basis: 'template',
      reason: 'insufficient history: 9 posts, floor is 15',
      productCoverage: { product: 'Jules', lastFeatured: '2026-02-03', mentions: 5 },
    };
    const out = rationaleFor(thin, 'x');
    expect(out).toContain('You haven’t posted about Jules since 3 February');
    expect(out).toContain('don’t have enough of your posting history');
  });
});

// ── groundingLines: the SHEET's reading of the same evidence (T1b) ───────────
//
// The card compresses the evidence into a sentence; the sheet lays it out one fact per line,
// each separately checkable. Both derive from rationaleEvidence and neither adds to it. The
// negative assertions matter most here, same as everywhere else in this file: a field that is
// absent produces NO LINE — never a zero, never "no data", never a hedge.

describe('groundingLines', () => {
  const kinds = (e: BeatEvidence, pillar = 'Stable Foundations') =>
    groundingLines(e, pillar).map((l) => l.kind);
  const textOf = (e: BeatEvidence, kind: string, pillar = 'Stable Foundations') =>
    groundingLines(e, pillar).find((l) => l.kind === kind)?.text;

  it('a product gap reads as the brief specifies', () => {
    expect(textOf({ basis: 'observed', productCoverage: { product: 'Jules', lastFeatured: '2026-02-03', mentions: 5 } }, 'product'))
      .toBe('Jules — last in a caption on 3 February (5 captions)');
  });

  it('a NEVER-featured product says so, and carries no date and no zero', () => {
    const line = textOf({ basis: 'observed', productCoverage: { product: 'Fiona', lastFeatured: null, mentions: 0 } }, 'product')!;
    expect(line).toBe('Fiona — never appeared in a caption');
    expect(line).not.toMatch(/\(0|1970|since|Invalid/);
  });

  it('singularises a one-caption sample', () => {
    expect(textOf({ basis: 'observed', productCoverage: { product: 'Thia', lastFeatured: '2025-12-22', mentions: 1 } }, 'product'))
      .toBe('Thia — last in a caption on 22 December (1 caption)');
  });

  it('a recurring series reads as the brief specifies', () => {
    expect(textOf({ basis: 'observed', seriesDue: { name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-26', monthsObserved: 2 } }, 'series'))
      .toBe('Sunday Style — weekly; last ran 26 July');
  });

  it('says monthly for a monthly series, and "hasn’t run yet" when it never has', () => {
    expect(textOf({ basis: 'observed', seriesDue: { name: 'What our customers see', dayOfWeek: 'monthly', lastPlanned: null, monthsObserved: 0 } }, 'series'))
      .toBe('What our customers see — monthly; hasn’t run yet');
  });

  it('a backlog beat gives the month AND quotes her sentence in full', () => {
    const idea = 'Why never to wear polyester or synthetics, especially in summer.';
    const line = groundingLines({
      basis: 'observed',
      candidateRank: { rank: 1, of: 6, origin: 'client', lifecycle: 'candidate' },
      backlogIdea: { text: idea, givenAt: '2026-06-14' },
    }, 'x').find((l) => l.kind === 'backlog')!;
    expect(line.text).toBe('From what you told us in June');
    // The title is a headline; the SHEET is where the whole sentence lives.
    expect(line.quote).toBe(idea);
  });

  it('drops the month rather than guessing when the backlog date is missing or malformed', () => {
    for (const givenAt of [null, 'nope']) {
      const line = groundingLines({ basis: 'observed', backlogIdea: { text: 'An idea', givenAt } }, 'x')
        .find((l) => l.kind === 'backlog')!;
      expect(line.text).toBe('From what you told us');
      expect(line.quote).toBe('An idea');
    }
  });

  it('states format engagement WITH its sample size', () => {
    expect(textOf({ basis: 'observed', formatEngagement: { format: 'carousel', avgEngagement: 31.9, posts: 86 } }, 'format'))
      .toBe('Carousels average 32 likes and comments across your last 86 posts');
  });

  it('states cadence and what it was measured over', () => {
    expect(textOf({ basis: 'observed', cadenceBasis: { postsPerWeek: 7.48, source: 'observed', months: 10 } }, 'cadence'))
      .toBe('You post about 7.48 times a week, measured over 10 months of your feed');
  });

  it('says a CONFIGURED cadence came from the account, not from the feed', () => {
    expect(textOf({ basis: 'observed', cadenceBasis: { postsPerWeek: 3, source: 'config', months: 0 } }, 'cadence'))
      .toBe('Planned at 3 posts a week, the rate set on your account');
  });

  it('states the pillar share', () => {
    expect(textOf({ basis: 'observed', pillarShare: 0.14 }, 'pillar', 'Simplify Your Morning'))
      .toBe('Simplify Your Morning is about 14% of what you post');
  });

  it('ABSENCE IS A VALUE: no evidence, no lines at all', () => {
    expect(groundingLines({ basis: 'observed' }, 'Stable Foundations')).toEqual([]);
  });

  it('omits every line whose field is absent — never a zero, never a placeholder', () => {
    expect(kinds({ basis: 'observed', productCoverage: { product: 'Bea', lastFeatured: null, mentions: 0 } }))
      .toEqual(['product']);
  });

  it('drops a zero-sample engagement figure rather than reporting a mean of nothing', () => {
    expect(kinds({ basis: 'observed', formatEngagement: { format: 'reel', avgEngagement: 0, posts: 0 } })).toEqual([]);
  });

  it('orders strongest and most specific first: series, product, her words, then measurements', () => {
    expect(kinds({
      basis: 'observed',
      seriesDue: { name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-26', monthsObserved: 2 },
      productCoverage: { product: 'Jules', lastFeatured: '2026-02-03', mentions: 5 },
      backlogIdea: { text: 'An idea', givenAt: '2026-06-01' },
      formatEngagement: { format: 'carousel', avgEngagement: 31.9, posts: 86 },
      pillarShare: 0.14,
      cadenceBasis: { postsPerWeek: 7.48, source: 'observed', months: 10 },
    })).toEqual(['series', 'product', 'backlog', 'format', 'pillar', 'cadence']);
  });

  it('a THIN-history beat still shows its facts, and names the gap last', () => {
    const out = kinds({
      basis: 'template',
      reason: 'insufficient history: 9 posts, floor is 15',
      seriesDue: { name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-26', monthsObserved: 2 },
      cadenceBasis: { postsPerWeek: 3, source: 'config', months: 0 },
    });
    expect(out).toEqual(['series', 'cadence', 'thin']);
  });

  it('a hand-added beat says only that, and claims no evidence it does not have', () => {
    expect(groundingLines({ basis: 'client_added' }, 'x')).toEqual([{ kind: 'added', text: 'You added this one yourself.' }]);
  });

  it('a client_input beat quotes her sentence rather than summarising it', () => {
    const line = groundingLines({ basis: 'client_input', reason: 'The Wilderness candle relaunches on the 24th' }, 'x')[0]!;
    expect(line.text).toBe('From what you told us');
    expect(line.quote).toBe('The Wilderness candle relaunches on the 24th');
  });

  it('a client_input beat with no recorded text says nothing rather than inventing one', () => {
    expect(groundingLines({ basis: 'client_input' }, 'x')).toEqual([]);
  });
});

/**
 * monthSummary — the month's account of itself, computed from the same evidence.
 *
 * The fixture is ivy-t's REAL September draft on UAT (cycle 0b9677e5), reduced to the fields the
 * summary reads. Every date, product, series and count below came out of `beat_meta`; nothing is
 * invented, so a change to the derivation shows up here as a changed real fact.
 */
const SEPT: DraftBeatView[] = [
  // Four pillar-only beats and the shape of the month around them.
  ['2026-09-01', 'carousel', 'A Supportive Friend, Always By Your Side'],
  ['2026-09-03', 'carousel', 'Ethical Without Compromise'],
  ['2026-09-07', 'carousel', 'Understands Real Women'],
  ['2026-09-30', 'reel',     'Born From Real Need'],
].map(([date, format, pillar], i) => ({
  id: `p${i}`, cycleId: 'c', date: date!, format: format as DraftBeatView['format'], pillar: pillar!,
  title: 't', position: i, slotType: 'proven' as const,
  evidence: { basis: 'observed' } as BeatEvidence,
  assumptions: [
    'No launches or restocks are on record for this month — the draft assumes a business-as-usual month.',
    'No pillar weights are on record, so the month splits evenly across pillars.',
  ],
}));

/** Her real series beats: WSG on four Saturdays, Sunday Style on four Sundays, two monthlies. */
const seriesBeat = (
  date: string, name: string, dayOfWeek: string, product: string, lastFeatured: string | null, mentions: number,
): DraftBeatView => ({
  id: `s-${date}`, cycleId: 'c', date, format: 'carousel', pillar: 'Simplify Your Morning',
  title: 't', position: 0, slotType: 'proven',
  evidence: {
    basis: 'observed',
    seriesDue: { name, dayOfWeek, lastPlanned: '2026-08-28', monthsObserved: 3 },
    productCoverage: { product, lastFeatured, mentions },
  },
  assumptions: [],
});

const SERIES: DraftBeatView[] = [
  seriesBeat('2026-09-05', 'WSG (Weekend Style Guide)', 'Saturday', 'Bea',    null,         0),
  seriesBeat('2026-09-12', 'WSG (Weekend Style Guide)', 'Saturday', 'Layla',  null,         0),
  seriesBeat('2026-09-19', 'WSG (Weekend Style Guide)', 'Saturday', 'Thia',   '2025-12-22', 1),
  seriesBeat('2026-09-26', 'WSG (Weekend Style Guide)', 'Saturday', 'Lydia',  '2026-02-22', 8),
  seriesBeat('2026-09-06', 'Sunday Style',              'Sunday',   'Fiona',  null,         0),
  seriesBeat('2026-09-13', 'Sunday Style',              'Sunday',   'Heather', '2025-12-17', 3),
  seriesBeat('2026-09-08', 'Notes from the Founder',    'monthly',  'Jane',   null,         0),
  seriesBeat('2026-09-23', 'What our customers see',    'monthly',  'Jen',    '2026-02-22', 2),
];

/** Two of her six real backlog beats, with the date she actually sent them. */
const HERS: DraftBeatView[] = ['2026-09-02', '2026-09-17'].map((date, i) => ({
  id: `h${i}`, cycleId: 'c', date, format: 'reel', pillar: 'Born From Real Need',
  title: 't', position: 0, slotType: 'experiment' as const,
  evidence: {
    basis: 'observed',
    backlogIdea: { text: 'Why never to wear polyester or synthetics, especially in summer.', givenAt: '2026-07-21' },
  } as BeatEvidence,
  assumptions: [],
}));

const OPTS = { monthName: 'September', editable: true };
const section = (s: ReturnType<typeof monthSummary>, key: string) =>
  s?.sections.find((x) => x.key === key) ?? null;
const texts = (s: ReturnType<typeof monthSummary>, key: string) =>
  section(s, key)?.facts.map((f) => f.text) ?? [];

describe('monthSummary — the shape, from the dates themselves', () => {
  it('counts the posts and the weeks they span, in the client’s word for them', () => {
    expect(monthSummary([...SEPT, ...SERIES, ...HERS], OPTS)!.headline)
      .toBe('14 planned posts across 5 weeks');
  });

  it('says what a draft IS and what happens next — the line the misreading needs', () => {
    expect(monthSummary(SEPT, OPTS)!.stage)
      .toBe('This is the shape of September — once you’re happy, we’ll write every post.');
  });

  it('promises nothing on a month that can no longer be worked on', () => {
    expect(monthSummary(SEPT, { ...OPTS, editable: false })!.stage).toBeNull();
  });

  it('an EMPTY month has no argument to state, so there is no panel at all', () => {
    expect(monthSummary([], OPTS)).toBeNull();
  });

  it('one post in one week reads as one post in one week', () => {
    const s = monthSummary([SEPT[0]!], OPTS)!;
    expect(s.headline).toBe('1 planned post across 1 week');
  });

  it('a week is a week, not seven days: the 1st and the 3rd are the same one', () => {
    expect(monthSummary([SEPT[0]!, SEPT[1]!], OPTS)!.headline).toBe('2 planned posts across 1 week');
  });

  it('a malformed date is left out of the week count rather than inventing a week', () => {
    const bad = { ...SEPT[0]!, id: 'bad', date: 'soon' };
    expect(monthSummary([bad], OPTS)!.headline).toBe('1 planned post');
  });

  it('states the format mix and every pillar with its own count', () => {
    const s = monthSummary([...SEPT, ...SERIES, ...HERS], OPTS);
    expect(texts(s, 'mix')[0]).toBe('11 carousels · 3 reels');
    expect(section(s, 'mix')!.facts.slice(1)).toEqual([
      { text: 'Simplify Your Morning', count: '8' },
      { text: 'Born From Real Need', count: '3' },
      { text: 'A Supportive Friend, Always By Your Side', count: '1' },
      { text: 'Ethical Without Compromise', count: '1' },
      { text: 'Understands Real Women', count: '1' },
    ]);
  });
});

describe('monthSummary — the standing commitments and the products', () => {
  const s = monthSummary([...SEPT, ...SERIES, ...HERS], OPTS);

  it('names each series and how many instances the month holds, on its own weekday', () => {
    expect(texts(s, 'series')).toEqual([
      'WSG (Weekend Style Guide) — 4 Saturdays',
      'Sunday Style — 2 Sundays',
      'Notes from the Founder — once this month',
      'What our customers see — once this month',
    ]);
  });

  it('a monthly series says "this month" — it has no weekday to name', () => {
    const monthly = monthSummary([seriesBeat('2026-09-08', 'Notes from the Founder', 'monthly', 'Jane', null, 0),
      seriesBeat('2026-09-22', 'Notes from the Founder', 'monthly', 'Jane', null, 0)], OPTS);
    expect(texts(monthly, 'series')).toEqual(['Notes from the Founder — 2 times this month']);
  });

  it('names every product and WHY it is here — never-featured first, then the oldest gap', () => {
    expect(texts(s, 'products')).toEqual([
      'Bea — never appeared in a caption',
      'Fiona — never appeared in a caption',
      'Jane — never appeared in a caption',
      'Layla — never appeared in a caption',
      'Heather — last in a caption on 17 December',
      'Thia — last in a caption on 22 December',
      'Jen — last in a caption on 22 February',
      'Lydia — last in a caption on 22 February',
    ]);
  });

  it('NEVER FEATURED carries no count — "0 captions" adds nothing to "never appeared"', () => {
    expect(texts(s, 'products')[0]).not.toMatch(/caption[s]?\)/);
  });

  it('counts her own ideas, and the months she sent them in', () => {
    expect(texts(s, 'client')).toEqual(['2 ideas you gave us in July']);
  });

  it('names each month once and in order, however many ideas came from it', () => {
    const spread = HERS.map((b, i) => ({
      ...b, id: `x${i}`,
      evidence: { ...b.evidence, backlogIdea: { text: 'idea', givenAt: i === 0 ? '2026-07-21' : '2026-06-03' } },
    }));
    expect(texts(monthSummary([...spread, ...HERS], OPTS), 'client')).toEqual(['4 ideas you gave us in June and July']);
  });

  it('an idea with no date shortens the line rather than guessing when it arrived', () => {
    const undated = { ...HERS[0]!, evidence: { basis: 'observed', backlogIdea: { text: 'idea', givenAt: null } } as BeatEvidence };
    expect(texts(monthSummary([undated], OPTS), 'client')).toEqual(['1 idea you gave us']);
  });
});

describe('monthSummary — absence is a value', () => {
  it('a month with no series, no products and no ideas builds none of those sections', () => {
    expect(monthSummary(SEPT, OPTS)!.sections.map((x) => x.key)).toEqual(['mix', 'assumptions']);
  });

  it('a THIN month says less — it never pads to the same shape as a full one', () => {
    const thin = monthSummary([SEPT[0]!, HERS[0]!], OPTS)!;
    expect(thin.headline).toBe('2 planned posts across 1 week');
    expect(thin.sections.map((x) => x.key)).toEqual(['mix', 'client', 'assumptions']);
    expect(texts(thin, 'client')).toEqual(['1 idea you gave us in July']);
  });

  /**
   * M4 — the day's assumption strip is gone, and the panel absorbed BOTH halves of it: the
   * statements it used to carry, and the one question the strip used to ask.
   */
  it('carries every assumption, and re-voices the answerable one as its question', () => {
    expect(section(monthSummary(SEPT, OPTS), 'assumptions')!.facts).toEqual([
      { text: 'No pillar weights are on record, so the month splits evenly across pillars.' },
      { text: 'We’ve assumed nothing’s launching this month — anything coming up?', answerable: true },
    ]);
  });

  it('asks the same one the strip asked — same predicate, same ranking, same wording', () => {
    const all = [...new Set(SEPT.flatMap((b) => b.assumptions))];
    const ranked = firstAnswerable(all)!;
    const asked = section(monthSummary(SEPT, OPTS), 'assumptions')!.facts.find((f) => f.answerable)!;
    expect(asked.text).toBe(assumptionPrompt(ranked));
  });

  it('asks ONE question, not one per assumption — the panel has room and still does not', () => {
    expect(section(monthSummary(SEPT, OPTS), 'assumptions')!.facts.filter((f) => f.answerable)).toHaveLength(1);
  });

  it('the question sorts LAST, so the panel’s tappable rows sit together', () => {
    const facts = section(monthSummary(SEPT, OPTS), 'assumptions')!.facts;
    expect(facts[facts.length - 1]!.answerable).toBe(true);
    expect(facts.slice(0, -1).every((f) => !f.answerable)).toBe(true);
  });

  it('asks NOTHING on a month that can no longer be changed — never a dead prompt', () => {
    const facts = section(monthSummary(SEPT, { ...OPTS, editable: false }), 'assumptions')!.facts;
    expect(facts.some((f) => f.answerable)).toBe(false);
    // Still stated, though. A closed month kept its assumptions before and keeps them now.
    expect(facts.map((f) => f.text)).toEqual([
      'No launches or restocks are on record for this month — the draft assumes a business-as-usual month.',
      'No pillar weights are on record, so the month splits evenly across pillars.',
    ]);
  });

  it('an assumption that is only a fact about OUR data is never dressed as a question', () => {
    const ours = 'the format mix is based on posts whose format we could not read';
    const beats = SEPT.map((b) => ({ ...b, assumptions: [ours] }));
    expect(section(monthSummary(beats, OPTS), 'assumptions')!.facts).toEqual([{ text: ours }]);
  });

  it('an assumption stated on ten beats is stated once', () => {
    expect(texts(monthSummary([...SEPT], OPTS), 'assumptions')).toHaveLength(2);
  });

  it('never says the internal word for a slot', () => {
    const s = monthSummary([...SEPT, ...SERIES, ...HERS], OPTS)!;
    const all = [s.headline, s.stage ?? '', ...s.sections.flatMap((x) => [x.heading, ...x.facts.map((f) => f.text)])];
    expect(all.join(' ')).not.toMatch(/\bbeats?\b/i);
  });

  it('is deterministic: the same month renders identically whatever order the beats arrive in', () => {
    const forward = monthSummary([...SEPT, ...SERIES, ...HERS], OPTS);
    const back = monthSummary([...SERIES, ...HERS, ...SEPT].reverse(), OPTS);
    expect(JSON.stringify(back)).toBe(JSON.stringify(forward));
  });
});

/**
 * S3 — the two readings share one derivation, so they cannot disagree.
 *
 * The summary's product line is the sheet's line with the caption count removed, and it is a
 * literal PREFIX of it. That is the checkable form of "they must never disagree": there is no
 * way to change one date without changing the other.
 */
describe('the summary and the beat sheet read the same evidence', () => {
  it('every product line in the panel is a prefix of that beat’s line on the sheet', () => {
    for (const b of SERIES) {
      const onSheet = groundingLines(b.evidence, b.pillar).find((l) => l.kind === 'product')!.text;
      const inPanel = texts(monthSummary([b], OPTS), 'products')[0]!;
      expect(onSheet.startsWith(inPanel), `${inPanel} ⊄ ${onSheet}`).toBe(true);
    }
  });

  it('the panel counts exactly the beats whose sheet shows her own words', () => {
    const all = [...SEPT, ...SERIES, ...HERS];
    const withHerWords = all.filter((b) => groundingLines(b.evidence, b.pillar).some((l) => l.kind === 'backlog'));
    expect(texts(monthSummary(all, OPTS), 'client')[0]).toBe(`${withHerWords.length} ideas you gave us in July`);
  });

  it('names a series the way the SHEET names it — the full form, not the title’s shorthand', () => {
    const b = SERIES[0]!;
    expect(groundingLines(b.evidence, b.pillar)[0]!.text).toContain('WSG (Weekend Style Guide)');
    expect(texts(monthSummary([b], OPTS), 'series')[0]).toContain('WSG (Weekend Style Guide)');
  });
});

describe('monthSummary — the format mix counts in the client’s own words', () => {
  it('one of a kind is ONE of that kind — the acceptance run said "1 carousels"', () => {
    const one = [{ ...SEPT[0]!, format: 'carousel' as const }, { ...SEPT[1]!, id: 'r', format: 'reel' as const }];
    expect(texts(monthSummary(one, OPTS), 'mix')[0]).toBe('1 carousel · 1 reel');
  });

  it('an unknown format is still counted, in the only word we have for it', () => {
    const odd = [{ ...SEPT[0]!, format: 'story' as unknown as DraftBeatView['format'] }];
    expect(texts(monthSummary(odd, OPTS), 'mix')[0]).toBe('1 story post');
  });
});
