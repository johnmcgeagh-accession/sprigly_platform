/**
 * ask-coverage.test.ts — the four hooks, caught.
 *
 * The fixture is ivy-t's LIVE September 2026 month, cycle d71da70e: the ten undated asks the
 * extractor persisted, and the thirty-three posts that generated from them. That pairing is the
 * whole point — the brief is complete and correct, the month is complete and plausible, and the
 * only thing separating it from an honoured brief is four opening lines nobody counted.
 *
 * The verdicts below are what the module says about real data, not what it was built to say.
 */
import { describe, it, expect } from 'vitest';
import {
  briefAskCoverage, NO_ASK_COVERAGE,
  VERBATIM_MIN_WORDS, VERBATIM_MIN_CONTENT, QUOTED_MIN_RUN,
} from './ask-coverage.js';
import { SEPT_BRIEF, SEPT_POSTS } from './ask-coverage.fixtures.js';

const HOOKS = [
  'customer-message-hook',
  'wardrobe-avoidance-hook',
  'shop-your-wardrobe-hook',
  'reach-for-same-clothes-hook',
];

describe('briefAskCoverage — ivy-t September 2026 (the month the hooks went missing)', () => {
  const cov = briefAskCoverage(SEPT_BRIEF, SEPT_POSTS);

  it('reads all ten asks', () => {
    expect(cov.items).toHaveLength(10);
    expect(cov.used.length + cov.unused.length + cov.unmeasured.length).toBe(10);
  });

  // ── THE FINDING ──────────────────────────────────────────────────────────────
  it('reports all four opening hooks as UNUSED — the loss found by hand in September', () => {
    expect(cov.unused.sort()).toEqual([...HOOKS].sort());
  });

  it('each hook is conclusive because the ask IS a quoted line, not prose about one', () => {
    for (const type of HOOKS) {
      const item = cov.items.find((i) => i.type === type)!;
      expect(item.quotedLine).not.toBeNull();
      expect(item.verdict).toBe('unused');
    }
  });

  it("the hooks' words appear nowhere: no run reaches the quoted-line bar", () => {
    for (const type of HOOKS) {
      expect(cov.items.find((i) => i.type === type)!.longestRun).toBeLessThan(QUOTED_MIN_RUN);
    }
  });

  // ── THE ASKS THAT LANDED ─────────────────────────────────────────────────────
  it('not-fast-fashion is USED — a 31-word verbatim run, well past the bar', () => {
    const item = cov.items.find((i) => i.type === 'not-fast-fashion-brand-values')!;
    expect(item.verdict).toBe('used');
    expect(item.longestRun).toBeGreaterThanOrEqual(VERBATIM_MIN_WORDS);
    expect(item.contentWords).toBeGreaterThanOrEqual(VERBATIM_MIN_CONTENT);
  });

  it('navy-edit-customer-reaction is USED — on the title echo, not on its prose', () => {
    const item = cov.items.find((i) => i.type === 'navy-edit-customer-reaction')!;
    expect(item.verdict).toBe('used');
    expect(item.titleEcho).toBe(true);
    // Its only prose overlap is "at the end of august and" — six words, two of them content.
    // The verbatim signal must NOT be what carries this one.
    expect(item.longestRun).toBeLessThan(VERBATIM_MIN_WORDS);
  });

  it('named-after-women-brand-story is USED — also a beat named after the ask', () => {
    const item = cov.items.find((i) => i.type === 'named-after-women-brand-story')!;
    expect(item.verdict).toBe('used');
    expect(item.titleEcho).toBe(true);
  });

  // ── THE HONEST HARD CASE ─────────────────────────────────────────────────────
  it('cost-per-wear is UNMEASURED, not unused — it landed thinly and the module says so', () => {
    const item = cov.items.find((i) => i.type === 'cost-per-wear-education')!;
    expect(item.verdict).toBe('unmeasured');
    expect(cov.unused).not.toContain('cost-per-wear-education');
    // Its best overlap is "for a long sleeve t shirt" — the client's PRODUCT vocabulary, six
    // words and four of them content. Calling that delivery of a cost-per-wear argument whose
    // specifics (24p per wear, "less than a coffee") appear nowhere would be a false positive;
    // calling it missing would be a false accusation on nine sentences of paraphrasable prose.
    expect(item.longestRun).toBeLessThan(VERBATIM_MIN_WORDS);
    expect(item.quotedLine).toBeNull();
  });

  it("never reports a thematic ask as unused — every 'unused' verdict carries a quoted line", () => {
    for (const item of cov.items) {
      if (item.verdict === 'unused') expect(item.quotedLine).not.toBeNull();
    }
  });
});

describe('briefAskCoverage — the predicate, isolated', () => {
  const ask = (type: string, note: string, product: string | null = null) =>
    ({ content_asks: [{ type, product, note }] });

  it('an ask appearing VERBATIM is detected as used', () => {
    const brief = ask('slow-fashion', 'We make clothes designed to be worn for years, not weeks, and we stand behind every one.');
    const cov = briefAskCoverage(brief, [
      { caption: 'Something first. We make clothes designed to be worn for years, not weeks, and we stand behind every one. 💛' },
    ]);
    expect(cov.used).toEqual(['slow-fashion']);
  });

  it('an ask appearing only as PARAPHRASE is unmeasured — it cannot tell, and does not guess', () => {
    const brief = ask('slow-fashion', 'We make clothes designed to be worn for years, not weeks, and we stand behind every one.');
    const cov = briefAskCoverage(brief, [
      { caption: 'Built to last season after season — we back every piece we sell.' },
    ]);
    const [item] = cov.items;
    expect(item!.verdict).toBe('unmeasured');
    expect(cov.unused).toEqual([]);          // silence, never an accusation
  });

  it('a QUOTED line that IS used reads as used', () => {
    const brief = ask('opener', 'Hook: Do you always reach for the same clothes?');
    const cov = briefAskCoverage(brief, [
      { caption: 'Do you always reach for the same clothes? Here is why that happens.' },
    ]);
    expect(cov.used).toEqual(['opener']);
  });

  it('a QUOTED line that is absent reads as unused', () => {
    const brief = ask('opener', 'Hook: Do you always reach for the same clothes?');
    const cov = briefAskCoverage(brief, [{ caption: 'Three ways to wear the Audrey this autumn.' }]);
    expect(cov.unused).toEqual(['opener']);
  });

  it('"Hook needed." is a REQUEST for a hook, not a hook — never quoted, never unused', () => {
    // A real UAT ask. A keyword scan would read this as a line to publish and report it
    // missing forever; the marker is anchored at the start of the note precisely to refuse it.
    const brief = ask('product-video-feature', 'Use the video of me fitting the pre production sample. Hook needed. Caption to follow.');
    const cov = briefAskCoverage(brief, [{ caption: 'Unrelated copy entirely.' }]);
    expect(cov.items[0]!.quotedLine).toBeNull();
    expect(cov.unused).toEqual([]);
  });

  it('a title echo alone is enough to call an ask used', () => {
    const brief = ask('refer-a-friend-reminder', 'Remind people about our Refer a Friend scheme.');
    const cov = briefAskCoverage(brief, [
      { title: 'September — refer a friend reminder', caption: 'Nothing matching the note at all.' },
    ]);
    expect(cov.used).toEqual(['refer-a-friend-reminder']);
    expect(cov.items[0]!.titleEcho).toBe(true);
  });

  it('stopword runs do not count as evidence', () => {
    // Eight words long, but every one of them a stopword — length without content is noise.
    const brief = ask('filler', 'It is what it is and that is all there is to it.');
    const cov = briefAskCoverage(brief, [{ caption: 'It is what it is and that is all there is to it.' }]);
    expect(cov.items[0]!.contentWords).toBeLessThan(VERBATIM_MIN_CONTENT);
  });

  it('a curly apostrophe in the brief still matches a straight one in the caption', () => {
    const brief = ask('lane', 'We don’t compete with fast fashion because we don’t make fast fashion at all.');
    const cov = briefAskCoverage(brief, [
      { caption: "We don't compete with fast fashion because we don't make fast fashion at all." },
    ]);
    expect(cov.used).toEqual(['lane']);
  });
});

describe('briefAskCoverage — degenerate inputs never throw and never accuse', () => {
  it('a brief with no asks yields no spurious shortfall', () => {
    expect(briefAskCoverage({ content_asks: [] }, SEPT_POSTS)).toEqual(NO_ASK_COVERAGE);
    expect(briefAskCoverage({ products: [], schedule: [] }, SEPT_POSTS)).toEqual(NO_ASK_COVERAGE);
  });

  it('a cycle with no posts does not error — every ask is simply unmeasured or unused', () => {
    const cov = briefAskCoverage(SEPT_BRIEF, []);
    expect(cov.items).toHaveLength(10);
    expect(cov.used).toEqual([]);
    expect(cov.unused.sort()).toEqual([...HOOKS].sort());   // still conclusive with no corpus
  });

  it('null, undefined, a string and a malformed brief all return the empty shape', () => {
    expect(briefAskCoverage(null, [])).toEqual(NO_ASK_COVERAGE);
    expect(briefAskCoverage(undefined, [])).toEqual(NO_ASK_COVERAGE);
    expect(briefAskCoverage('not a brief', [])).toEqual(NO_ASK_COVERAGE);
    expect(briefAskCoverage({ content_asks: 'not an array' }, [])).toEqual(NO_ASK_COVERAGE);
  });

  it('skips junk entries inside content_asks rather than failing the measurement', () => {
    const cov = briefAskCoverage(
      { content_asks: [null, 'nope', { type: '' }, { type: 'real', product: null, note: 'Hook: Do you avoid sorting your wardrobe out?' }] },
      [{ caption: 'nothing' }],
    );
    expect(cov.items).toHaveLength(1);
    expect(cov.unused).toEqual(['real']);
  });

  it('posts with null/absent fields are read as empty, not as a crash', () => {
    const cov = briefAskCoverage(SEPT_BRIEF, [{}, { caption: null }, { title: undefined, caption: '' }]);
    expect(cov.items).toHaveLength(10);
  });

  it('takes no db and no model — the whole signature is (brief, posts)', () => {
    expect(briefAskCoverage.length).toBe(2);
  });
});
