/**
 * draft-coverage.test.ts — which products the month has stopped talking about.
 *
 * The fixtures are ivy-t's REAL collisions, measured against the live 276 captions
 * (docs/reports/beat-grounding.md §3a): "Ivy" the brand in 84 captions, "Joy" the product
 * she writes four times as an ordinary word, "Erin Midweight" the parser artefact of the
 * "Erin" family. Each of those, unguarded, breaks the claim in a different direction.
 */
import { describe, it, expect } from 'vitest';
import {
  observeProductCoverage, catalogueProductNames, staleProducts, productBeatCap,
  PRODUCT_STALE_DAYS, PRODUCT_COVERAGE_SHARE, type ProductCoverage,
} from './draft-coverage.js';
import { assembleDraft, type AssembleDraftParams } from './draft-assembly.js';
import { resolveRecurringSeries } from './draft-recurring.js';
import type { HistoryPost } from './draft-history.js';
import type { Pillar, RecurringSeries } from './types.js';

const post = (date: string, caption: string): HistoryPost =>
  ({ timestamp: `${date}T10:00:00.000Z`, caption, likesCount: 40, commentsCount: 2, mediaType: 'reel' });

const NAMES = ['Bea', 'Claire', 'Erin', 'Erin Midweight', 'Hannah', 'Ivy', 'Joy', 'Jules'];

const CAPTIONS: HistoryPost[] = [
  post('2026-07-20', 'Styling the Claire skirt three ways this week.'),
  post('2026-07-01', 'The Hannah tee is back on the rail.'),
  post('2026-06-14', 'Erin in ecru — our most-worn cut.'),
  post('2026-02-03', 'Jules, the one you asked us to bring back.'),
  post('2026-05-02', 'Pure joy watching these leave the studio 🤍'),   // lower case — a word
  post('2026-04-11', 'so much joy in this one'),                       // lower case — a word
  post('2026-03-01', 'The Joy vest, finally restocked.'),              // the actual product
  post('2026-07-30', '8 years of Ivy 🤍 from a kitchen table to this.'),// the brand
  post('2026-07-31', 'Ivy is eight this month and we are so proud.'),   // the brand
];

/** deriveBrandTokens('IVY-t') — the 1-char "t" is dropped by the length floor. */
const BRAND = new Set(['ivy']);

describe('catalogueProductNames', () => {
  it('reads distinct family names out of a cached blob, sorted', () => {
    const blob = { families: [{ name: 'Hannah' }, { name: 'Claire' }, { name: 'Hannah' }] };
    expect(catalogueProductNames(blob)).toEqual(['Claire', 'Hannah']);
  });

  it('returns [] for a missing, empty or malformed catalogue rather than throwing', () => {
    expect(catalogueProductNames(null)).toEqual([]);
    expect(catalogueProductNames(undefined)).toEqual([]);
    expect(catalogueProductNames({})).toEqual([]);
    expect(catalogueProductNames({ families: 'nope' })).toEqual([]);
    expect(catalogueProductNames({ families: [{}, { name: '  ' }, { name: 7 }] })).toEqual([]);
  });
});

describe('observeProductCoverage — the three guards', () => {
  const { coverage, excluded } = observeProductCoverage({ names: NAMES, posts: CAPTIONS, brandTokens: BRAND });
  const find = (p: string) => coverage.find((c) => c.product === p);
  const why  = (p: string) => excluded.find((e) => e.name === p)?.reason;

  it('excludes the BRAND, so 84 captions about the company are not 84 product mentions', () => {
    expect(why('Ivy')).toBe('brand');
    expect(find('Ivy')).toBeUndefined();
  });

  it('excludes a name she writes as an ORDINARY WORD at least as often as as a product', () => {
    // "pure joy" twice against one "The Joy vest". The case rule would count it correctly, but
    // a title using the word honestly must not be rejected by the phrasing validator — so Joy
    // leaves the vocabulary.
    expect(why('Joy')).toBe('ambiguous');
    expect(find('Joy')).toBeUndefined();
  });

  it('KEEPS a product she lower-cased once against many capitalised mentions', () => {
    // The regression this guards, found in ivy-t's live acceptance run: an absolute rule
    // ("excluded if she ever lower-cases it") threw out CONNIE — her flagship July launch — on
    // one caption, "my grey marl connie", against forty-two capitalised ones. One typo is not
    // a vocabulary.
    const posts = [
      post('2026-04-03', 'my grey marl connie (which will officially be back this July)'),
      ...Array.from({ length: 42 }, (_, i) => post(`2026-07-${String((i % 28) + 1).padStart(2, '0')}`, 'The Connie Edit is here')),
    ];
    const out = observeProductCoverage({ names: ['Connie'], posts, brandTokens: new Set() });
    expect(out.excluded).toEqual([]);
    expect(out.coverage[0]!.product).toBe('Connie');
  });

  it('excludes on a TIE — written as a word as often as as a product is a word', () => {
    const posts = [post('2026-07-01', 'The Rose dress'), post('2026-07-02', 'a rose by any other name')];
    const out = observeProductCoverage({ names: ['Rose'], posts, brandTokens: new Set() });
    expect(out.excluded[0]).toEqual({ name: 'Rose', reason: 'ambiguous' });
  });

  it('never excludes a NEVER-MENTIONED product — 0 and 0 is not ambiguity', () => {
    // The products this module exists to surface all score zero on both counts.
    const out = observeProductCoverage({ names: ['Bea'], posts: [post('2026-07-01', 'unrelated')], brandTokens: new Set() });
    expect(out.excluded).toEqual([]);
    expect(out.coverage[0]).toEqual({ product: 'Bea', lastFeatured: null, mentions: 0 });
  });

  it('excludes a PARSER ARTEFACT whose real family is already in the list', () => {
    // "Erin Midweight" has no captions of its own and would win the staleness ranking outright.
    expect(why('Erin Midweight')).toBe('parse-artefact');
    expect(find('Erin')).toBeDefined();
  });

  it('REPORTS every exclusion rather than dropping it silently', () => {
    expect(excluded.map((e) => e.name)).toEqual(['Erin Midweight', 'Ivy', 'Joy']);
  });

  it('dates a product from the most recent caption naming it', () => {
    expect(find('Claire')).toEqual({ product: 'Claire', lastFeatured: '2026-07-20', mentions: 1 });
    expect(find('Jules')).toEqual({ product: 'Jules', lastFeatured: '2026-02-03', mentions: 1 });
  });

  it('says NEVER FEATURED as null — not a zero, not an epoch, not an empty string', () => {
    expect(find('Bea')).toEqual({ product: 'Bea', lastFeatured: null, mentions: 0 });
  });

  it('matches whole words only', () => {
    const out = observeProductCoverage({
      names: ['Bea'], posts: [post('2026-07-01', 'Beautiful weather for it')], brandTokens: new Set(),
    });
    expect(out.coverage[0]!.mentions).toBe(0);
  });

  it('is CASE-SENSITIVE — that is the guard, not an accident', () => {
    const out = observeProductCoverage({
      names: ['Rose'],
      posts: [post('2026-07-01', 'The Rose dress'), post('2026-07-02', 'a rose by any other name')],
      brandTokens: new Set(),
    });
    // 'Rose' is dropped as ambiguous because she writes "rose" — but where it is NOT dropped,
    // only the capitalised occurrence counts.
    expect(out.excluded[0]).toEqual({ name: 'Rose', reason: 'ambiguous' });
  });

  it('sorts stalest first: never featured, then oldest, then by name', () => {
    expect(coverage.map((c) => c.product)).toEqual(['Bea', 'Jules', 'Erin', 'Hannah', 'Claire']);
  });

  it('handles a client with no captions at all — everything is never-featured', () => {
    const out = observeProductCoverage({ names: ['Bea', 'Claire'], posts: [], brandTokens: new Set() });
    expect(out.coverage.every((c) => c.lastFeatured === null && c.mentions === 0)).toBe(true);
  });

  it('ignores posts with no caption rather than counting them as evidence of absence', () => {
    const noCaption: HistoryPost = { timestamp: '2026-07-01T10:00:00.000Z', likesCount: 1, commentsCount: 0 };
    const out = observeProductCoverage({ names: ['Claire'], posts: [noCaption], brandTokens: new Set() });
    expect(out.coverage[0]).toEqual({ product: 'Claire', lastFeatured: null, mentions: 0 });
  });

  it('is deterministic regardless of the order names or posts arrive in', () => {
    const again = observeProductCoverage({
      names: [...NAMES].reverse(), posts: [...CAPTIONS].reverse(), brandTokens: BRAND,
    });
    expect(again).toEqual({ coverage, excluded });
  });
});

describe('staleProducts — measured back from the month being PROPOSED', () => {
  const coverage: ProductCoverage[] = [
    { product: 'Never',  lastFeatured: null,         mentions: 0 },
    { product: 'Old',    lastFeatured: '2026-02-03', mentions: 5 },
    { product: 'Recent', lastFeatured: '2026-07-20', mentions: 3 },
  ];

  it('always includes a never-featured product', () => {
    expect(staleProducts(coverage, '2026-09').map((c) => c.product)).toContain('Never');
  });

  it('includes a product past the threshold and excludes one inside it', () => {
    const out = staleProducts(coverage, '2026-09').map((c) => c.product);
    expect(out).toContain('Old');
    expect(out).not.toContain('Recent');
  });

  it('measures from the first of the PLAN month, not from the assembling month', () => {
    // 2026-09-01 minus 90 days is 2026-06-03, so a June-3rd mention is not yet stale.
    const borderline: ProductCoverage[] = [{ product: 'Edge', lastFeatured: '2026-06-03', mentions: 1 }];
    expect(staleProducts(borderline, '2026-09')).toEqual([]);
    expect(staleProducts([{ product: 'Edge', lastFeatured: '2026-06-02', mentions: 1 }], '2026-09')).toHaveLength(1);
  });

  it('rolls the year correctly', () => {
    expect(PRODUCT_STALE_DAYS).toBe(90);
    expect(staleProducts([{ product: 'X', lastFeatured: '2025-10-01', mentions: 1 }], '2026-01')).toHaveLength(1);
  });
});

describe('productBeatCap — a month is not a catalogue readthrough', () => {
  it('is a third of the month', () => {
    expect(PRODUCT_COVERAGE_SHARE).toBe(1 / 3);
    expect(productBeatCap(30)).toBe(10);
    expect(productBeatCap(12)).toBe(4);
  });

  it('never caps a non-empty month to zero', () => {
    expect(productBeatCap(1)).toBe(1);
    expect(productBeatCap(2)).toBe(1);
  });

  it('is zero only for an empty month', () => {
    expect(productBeatCap(0)).toBe(0);
    expect(productBeatCap(-1)).toBe(0);
  });
});

// ── End to end ───────────────────────────────────────────────────────────────

const IG: HistoryPost[] = [
  ...Array.from({ length: 40 }, (_, i) => post(`2026-0${(i % 3) + 5}-${String((i % 28) + 1).padStart(2, '0')}`, 'x')),
  ...CAPTIONS,
];

const PILLARS: Pillar[] = [
  { name: 'Everyday Ritual', tagline: '', keyMessages: [], contentIdeas: [] },
  { name: 'Brand Story',     tagline: '', keyMessages: [], contentIdeas: [] },
];

const CONFIGURED: RecurringSeries[] = [
  { name: 'Sunday Style', dayOfWeek: 'Sunday', time: '8pm', format: 'Carousel', whoPosts: 'Sprigly' },
];
const SERIES = resolveRecurringSeries(CONFIGURED, ['Sunday Style'], [
  { date: '2026-07-26', category: 'Sunday Style', title: 'Sunday Style: Claire' },
]);

const COVERAGE = observeProductCoverage({ names: NAMES, posts: CAPTIONS, brandTokens: BRAND }).coverage;

const baseParams = (over: Partial<AssembleDraftParams> = {}): AssembleDraftParams => ({
  clientId: 'c', cycleId: 'cy', channel: 'instagram', month: '2026-09',
  posts: IG, pillars: PILLARS, candidates: [], temperature: null,
  hasCatalogue: true, hasBriefedLaunch: true, ...over,
});

describe('assembleDraft — a beat that names a product says why', () => {
  const draft = assembleDraft(baseParams({ productCoverage: COVERAGE, series: SERIES }));
  const withProduct = draft.beats.filter((b) => b.beatMeta.rationaleEvidence.productCoverage);

  it('names products on beats, capped at a third of the month', () => {
    expect(withProduct.length).toBeGreaterThan(0);
    expect(withProduct.length).toBeLessThanOrEqual(productBeatCap(draft.beats.length));
  });

  it('gives the STALEST products out first', () => {
    const named = withProduct.map((b) => b.beatMeta.rationaleEvidence.productCoverage!.product);
    expect(named[0]).toBe('Bea');            // never featured
    expect(named[1]).toBe('Jules');          // 3 February, the oldest date
  });

  it('carries the coverage gap as evidence, sample and all', () => {
    const jules = withProduct.find((b) => b.beatMeta.rationaleEvidence.productCoverage!.product === 'Jules')!;
    expect(jules.beatMeta.rationaleEvidence.productCoverage).toEqual({
      product: 'Jules', lastFeatured: '2026-02-03', mentions: 1,
    });
  });

  it('titles a coverage beat with no series for the product alone', () => {
    // With series configured, both stale products land on Sundays (series get theirs first),
    // so the plain shape has to be observed on a month with no series at all.
    const noSeries = assembleDraft(baseParams({ productCoverage: COVERAGE }));
    const plain = noSeries.beats.find((b) => b.beatMeta.rationaleEvidence.productCoverage)!;
    expect(plain.title).toBe('Bea — Reel');
  });

  it('gives the SERIES beats their products first — "Sunday Style: Bea"', () => {
    // This is the June/July shape restored: "Sunday Style: Claire", "WSG: Maggie Almond".
    const seriesBeat = draft.beats.find((b) => b.beatMeta.rationaleEvidence.seriesDue)!;
    expect(seriesBeat.beatMeta.rationaleEvidence.productCoverage).toBeDefined();
    expect(seriesBeat.title).toBe('Sunday Style: Bea — Carousel');
  });

  it('never overwrites the client\'s own words with our gap analysis', () => {
    const withIdeas = assembleDraft(baseParams({
      productCoverage: COVERAGE, series: SERIES, temperature: 1,
      candidates: Array.from({ length: 30 }, (_, i) => ({ id: `pi-${i}`, content: `idea ${i}`, origin: 'client' as const, lifecycle: 'candidate' })),
    }));
    for (const b of withIdeas.beats) {
      const ev = b.beatMeta.rationaleEvidence;
      expect(ev.candidateRank !== undefined && ev.productCoverage !== undefined).toBe(false);
    }
  });

  it('drops the catalogue assumption once a beat names a product', () => {
    expect(draft.assumptions.some((a) => /names a specific product|catalogue is cached/i.test(a))).toBe(false);
  });

  it('RAISES the assumption when a catalogue exists but nothing in it is stale', () => {
    const allFresh = COVERAGE.map((c) => ({ ...c, lastFeatured: '2026-08-30', mentions: 5 }));
    const fresh = assembleDraft(baseParams({ productCoverage: allFresh }));
    expect(fresh.beats.every((b) => !b.beatMeta.rationaleEvidence.productCoverage)).toBe(true);
    expect(fresh.assumptions.some((a) => /No beat names a specific product this month/.test(a))).toBe(true);
  });

  it('keeps slot count, dates and pillars identical to a month with no coverage', () => {
    const none = assembleDraft(baseParams({ series: SERIES }));
    expect(draft.beats.map((b) => b.scheduledDate)).toEqual(none.beats.map((b) => b.scheduledDate));
    expect(draft.beats.map((b) => b.pillar)).toEqual(none.beats.map((b) => b.pillar));
    expect(draft.beats.map((b) => b.format)).toEqual(none.beats.map((b) => b.format));
  });

  it('is deterministic — the same catalogue and captions choose the same products', () => {
    const again = assembleDraft(baseParams({ productCoverage: COVERAGE, series: SERIES }));
    expect(JSON.stringify(again.beats)).toBe(JSON.stringify(draft.beats));
  });

  it('carries coverage on the THIN-HISTORY path too — a caption date is not an inference', () => {
    const thin = assembleDraft(baseParams({ posts: IG.slice(0, 5), productCoverage: COVERAGE }));
    expect(thin.basis).toBe('template');
    expect(thin.beats.some((b) => b.beatMeta.rationaleEvidence.productCoverage)).toBe(true);
  });
});
