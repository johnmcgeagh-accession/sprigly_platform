/**
 * caption-overlap.test.ts — the measure, pinned to the month it was derived from.
 *
 * The fixtures are verbatim July 2026 (see caption-overlap.fixtures.ts). Where a test asserts a
 * specific score it is pinning a REAL number, not an invented one: 0.892 is what the 13 July post
 * actually scores against what we actually wrote for her, and if a change to the tokeniser moves
 * it, that is a fact somebody has to look at rather than a fixture to update.
 */
import { describe, it, expect } from 'vitest';
import {
  ADOPTION_MATCH_THRESHOLD,
  tokenise,
  captionOverlap,
  counted,
  overlapOfCounts,
  scoreMonth,
  monthHealth,
  asPercent,
  type SpriglyCaptionChain,
  type PublishedCaption,
} from './caption-overlap.js';
import {
  VERBATIM_1_00,
  NEAR_THRESHOLD,
  SELF_WRITTEN,
  RESHAPED_MATCH,
  TYPED_OVER_MATCH,
  NO_PLAN_ROW,
} from './caption-overlap.fixtures.js';

/** The chain rule, exactly as the admin loader builds it — baseline, then reshapes in order,
 *  then the live caption only when the client never typed into the row. */
function chainOf(f: { date: string; baseline: string; live: string; reshapes: string[]; userTyped: boolean }): SpriglyCaptionChain {
  const variants: string[] = [];
  if (f.baseline.trim()) variants.push(f.baseline);
  for (const r of f.reshapes) if (r.trim()) variants.push(r);
  if (f.live.trim() && !f.userTyped) variants.push(f.live);
  return { postId: `post-${f.date}`, scheduledDate: f.date, variants };
}

const pub = (f: { date: string; published: string }): PublishedCaption =>
  ({ timestamp: `${f.date}T09:00:00.000Z`, caption: f.published });

const best = (published: string, chains: SpriglyCaptionChain[]) => {
  const r = scoreMonth({ month: '2026-07', published: [{ timestamp: '2026-07-01T00:00:00.000Z', caption: published }], chains });
  if (r.state !== 'measured') throw new Error(`expected measured, got ${r.state}`);
  return r.matches[0]!;
};

describe('the overlap function', () => {
  it('is directional — the published caption is the denominator', () => {
    // Our caption may carry words hers does not (a scheduling note, a longer sign-off) without
    // costing anything. Hers carrying words ours does not is exactly what divergence measures.
    expect(captionOverlap(tokenise('linen shirt'), tokenise('a soft linen shirt in almond'))).toBe(1);
    expect(captionOverlap(tokenise('a soft linen shirt in almond'), tokenise('linen shirt'))).toBeCloseTo(2 / 6, 6);
  });

  it('counts words, not distinct words', () => {
    // Set intersection would call these identical. They are not the same caption.
    expect(captionOverlap(tokenise('linen linen linen linen'), tokenise('linen'))).toBe(0.25);
  });

  it('scores an empty published caption 0, never 1', () => {
    expect(captionOverlap(tokenise(''), tokenise('anything at all'))).toBe(0);
    expect(captionOverlap(tokenise(null), tokenise('anything at all'))).toBe(0);
  });

  it('drops punctuation, case and emoji, and keeps a hashtag as its bare word', () => {
    expect(tokenise('Linen, LOVED. 🤍 #LinenLove')).toEqual(['linen', 'loved', 'linenlove']);
  });

  it('the counted form the scorer uses is the same measure as the readable one', () => {
    // The scorer runs `overlapOfCounts` tens of thousands of times and `captionOverlap` never.
    // If they can disagree, the fast one is a different metric wearing the slow one's name.
    const texts = [
      VERBATIM_1_00.published, VERBATIM_1_00.live,
      NEAR_THRESHOLD.published, NEAR_THRESHOLD.baseline, NEAR_THRESHOLD.live,
      RESHAPED_MATCH.published, RESHAPED_MATCH.baseline, ...RESHAPED_MATCH.reshapes,
      TYPED_OVER_MATCH.published, TYPED_OVER_MATCH.baseline, ...TYPED_OVER_MATCH.reshapes,
      SELF_WRITTEN.published, NO_PLAN_ROW.published,
      '', 'linen', 'linen linen linen', 'one two three',
    ].map(tokenise);

    for (const a of texts) {
      for (const b of texts) {
        expect(overlapOfCounts(counted(a), counted(b))).toBeCloseTo(captionOverlap(a, b), 12);
      }
    }
  });
});

describe('July 2026, verbatim', () => {
  it('a caption pasted unchanged scores 1.00 and matches', () => {
    const m = best(VERBATIM_1_00.published, [chainOf(VERBATIM_1_00)]);
    expect(m.overlap).toBe(1);
    expect(m.matched).toBe(true);
    expect(m.plannedFor).toBe('2026-07-15');
  });

  it('a heavily-edited caption still matches, and its distance is the divergence', () => {
    const m = best(NEAR_THRESHOLD.published, [chainOf(NEAR_THRESHOLD)]);
    expect(m.overlap).toBeCloseTo(0.892, 3);
    expect(m.matched).toBe(true);
    // Just over 10% of what she published on 13 July is not our words — the honest reading is
    // "she used it and trimmed it", not "she rewrote it".
    expect(1 - m.overlap).toBeCloseTo(0.108, 3);
  });

  it('a post she wrote herself matches nothing we ever wrote', () => {
    const chains = [VERBATIM_1_00, NEAR_THRESHOLD, RESHAPED_MATCH, TYPED_OVER_MATCH].map(chainOf);
    const m = best(SELF_WRITTEN.published, chains);
    expect(m.matched).toBe(false);
    expect(m.overlap).toBeLessThan(0.5);
    expect(m.postId).toBeNull();       // an unmatched post names no plan row, ever
    expect(m.plannedFor).toBeNull();
  });

  it('a published post with no plan row behind it is unmatched, not an error', () => {
    const m = best(NO_PLAN_ROW.published, [chainOf(VERBATIM_1_00), chainOf(NEAR_THRESHOLD)]);
    expect(m.matched).toBe(false);
  });
});

describe('the Sprigly chain — whose words are in the pool', () => {
  it('a reshape carries the match the baseline cannot reach', () => {
    // 24 July: she asked for a rewrite, we wrote it twice, she posted the second one. Against
    // the BASELINE this is 0.43 and reads as a post she wrote herself. Against the chain it is
    // 0.99. Measuring only from the original would have called our own instructed rewrite a
    // failure to adopt — which is the exact error the refinement exists to prevent.
    const baselineOnly: SpriglyCaptionChain = {
      postId: 'p', scheduledDate: TYPED_OVER_MATCH.date, variants: [TYPED_OVER_MATCH.baseline],
    };
    const vsBaseline = best(TYPED_OVER_MATCH.published, [baselineOnly]);
    const vsChain    = best(TYPED_OVER_MATCH.published, [chainOf(TYPED_OVER_MATCH)]);

    expect(vsBaseline.overlap).toBeCloseTo(0.429, 2);
    expect(vsBaseline.matched).toBe(false);
    expect(vsChain.overlap).toBeCloseTo(0.988, 2);
    expect(vsChain.matched).toBe(true);
  });

  it('the newest reshape wins, and the older one does not drag the score down', () => {
    // Two reshapes on the 24th: 0.83 then 0.99. `max`, not `last` and not a mean — the chain is
    // a set of things we wrote, and the question is whether ANY of them is what she posted.
    const m = best(TYPED_OVER_MATCH.published, [chainOf(TYPED_OVER_MATCH)]);
    expect(m.matched).toBe(true);
    expect(m.overlap).toBeGreaterThan(0.98);
  });

  it('an instructed reshape is not charged as divergence', () => {
    // 23 July matches either way — the baseline is 0.852, a whisker over the cut. What changes is
    // the DIVERGENCE it reports: 14.8% from the baseline, 3.6% from the reshape. The first would
    // have told the operator her voice was drifting when all that happened is she asked us for a
    // change and we made it.
    const baselineOnly: SpriglyCaptionChain = {
      postId: 'p', scheduledDate: RESHAPED_MATCH.date, variants: [RESHAPED_MATCH.baseline],
    };
    const vsBaseline = best(RESHAPED_MATCH.published, [baselineOnly]);
    const vsChain    = best(RESHAPED_MATCH.published, [chainOf(RESHAPED_MATCH)]);

    expect(vsBaseline.matched).toBe(true);
    expect(1 - vsBaseline.overlap).toBeCloseTo(0.148, 2);
    expect(1 - vsChain.overlap).toBeCloseTo(0.036, 2);
  });

  it('a caption the client typed herself is NOT in the pool', () => {
    // The row she typed into holds her words. Scoring her own writing as our adoption is the one
    // way this measure overstates, and the flag is what closes it.
    const typed = { ...TYPED_OVER_MATCH, baseline: '', reshapes: [], userTyped: true };
    expect(chainOf(typed).variants).toEqual([]);

    const untyped = { ...typed, userTyped: false };
    expect(chainOf(untyped).variants).toEqual([TYPED_OVER_MATCH.live]);
  });

  it('a post with no recoverable Sprigly text is counted, not silently dropped', () => {
    const empty: SpriglyCaptionChain = { postId: 'p', scheduledDate: '2026-07-09', variants: [] };
    const r = scoreMonth({ month: '2026-07', published: [pub(VERBATIM_1_00)], chains: [chainOf(VERBATIM_1_00), empty] });
    expect(r.state).toBe('measured');
    if (r.state !== 'measured') return;
    expect(r.chainsWithoutSpriglyText).toBe(1);
  });
});

describe('the threshold, at the boundary', () => {
  // Nine words. Dropping k of them puts the score at (9-k)/9 exactly, so the boundary is
  // reachable without any dependence on real prose.
  const NINE = 'one two three four five six seven eight nine';
  const chain = (text: string): SpriglyCaptionChain[] => [{ postId: 'p', scheduledDate: '2026-07-01', variants: [text] }];

  it('matches at exactly the threshold — the comparison is >=, not >', () => {
    const r = scoreMonth({
      month: '2026-07',
      published: [{ timestamp: '2026-07-01T00:00:00.000Z', caption: NINE }],
      chains: chain(NINE),
      threshold: 1,
    });
    if (r.state !== 'measured') throw new Error('expected measured');
    expect(r.matches[0]!.overlap).toBe(1);
    expect(r.matches[0]!.matched).toBe(true);
  });

  it('8 of 9 words (0.889) matches at 0.85; 7 of 9 (0.778) does not', () => {
    const eight = best(NINE, chain('one two three four five six seven eight'));
    const seven = best(NINE, chain('one two three four five six seven'));
    expect(eight.overlap).toBeCloseTo(8 / 9, 6);
    expect(eight.matched).toBe(true);
    expect(seven.overlap).toBeCloseTo(7 / 9, 6);
    expect(seven.matched).toBe(false);
    expect(8 / 9).toBeGreaterThan(ADOPTION_MATCH_THRESHOLD);
    expect(7 / 9).toBeLessThan(ADOPTION_MATCH_THRESHOLD);
  });

  it('a caller-supplied threshold moves the boundary and nothing else', () => {
    const strict = scoreMonth({
      month: '2026-07',
      published: [{ timestamp: '2026-07-01T00:00:00.000Z', caption: NINE }],
      chains: chain('one two three four five six seven eight'),
      threshold: 0.95,
    });
    if (strict.state !== 'measured') throw new Error('expected measured');
    expect(strict.matches[0]!.overlap).toBeCloseTo(8 / 9, 6);   // the score is unchanged
    expect(strict.matches[0]!.matched).toBe(false);             // the verdict is not
  });

  it('the shipped default is 0.85, named once', () => {
    expect(ADOPTION_MATCH_THRESHOLD).toBe(0.85);
  });
});

describe('the two measures are independent', () => {
  const matched  = chainOf(VERBATIM_1_00);
  const alsoMatched = chainOf(NEAR_THRESHOLD);

  it('an unmatched post moves adoption and leaves divergence untouched', () => {
    const withoutMiss = scoreMonth({
      month: '2026-07',
      published: [pub(VERBATIM_1_00), pub(NEAR_THRESHOLD)],
      chains: [matched, alsoMatched],
    });
    const withMiss = scoreMonth({
      month: '2026-07',
      published: [pub(VERBATIM_1_00), pub(NEAR_THRESHOLD), pub(SELF_WRITTEN)],
      chains: [matched, alsoMatched],
    });
    if (withoutMiss.state !== 'measured' || withMiss.state !== 'measured') throw new Error('expected measured');

    expect(withoutMiss.adoption).toBe(1);
    expect(withMiss.adoption).toBeCloseTo(2 / 3, 6);            // adoption fell
    expect(withMiss.matched).toBe(2);
    expect(withMiss.divergence).toBeCloseTo(withoutMiss.divergence!, 10);   // divergence did not
  });

  it('divergence is the mean over MATCHED pairs only', () => {
    const r = scoreMonth({
      month: '2026-07',
      published: [pub(VERBATIM_1_00), pub(NEAR_THRESHOLD), pub(SELF_WRITTEN)],
      chains: [matched, alsoMatched],
    });
    if (r.state !== 'measured') throw new Error('expected measured');
    const expected = ((1 - 1) + (1 - 0.892)) / 2;
    expect(r.divergence).toBeCloseTo(expected, 2);
    // If the unmatched post were folded in as "100% diverged" this would be ~0.4.
    expect(r.divergence!).toBeLessThan(0.1);
  });

  it('nothing matched ⇒ divergence is null, never 0', () => {
    const r = scoreMonth({ month: '2026-07', published: [pub(SELF_WRITTEN)], chains: [matched] });
    if (r.state !== 'measured') throw new Error('expected measured');
    expect(r.matched).toBe(0);
    expect(r.adoption).toBe(0);
    expect(r.divergence).toBeNull();
  });
});

describe('the states that are not a number', () => {
  it('a month never trawled says so', () => {
    expect(monthHealth('2026-04', null, [chainOf(VERBATIM_1_00)])).toEqual({ state: 'not_trawled', month: '2026-04' });
  });

  it('a trawled month with no captions is not 0% adoption', () => {
    const r = monthHealth('2026-07', [{ timestamp: '2026-07-01T00:00:00.000Z', caption: null }], [chainOf(VERBATIM_1_00)]);
    expect(r).toEqual({ state: 'no_captions', month: '2026-07', published: 1 });
  });

  it('a month we never planned is not 0% adoption either', () => {
    const r = monthHealth('2026-07', [pub(VERBATIM_1_00)], []);
    expect(r).toEqual({ state: 'no_plan', month: '2026-07', published: 1 });
  });

  it('a plan pool that holds only client-typed rows reads as no_plan', () => {
    const r = monthHealth('2026-07', [pub(VERBATIM_1_00)], [{ postId: 'p', scheduledDate: '2026-07-15', variants: [] }]);
    expect(r.state).toBe('no_plan');
  });

  it('a post with no caption leaves the denominator rather than counting as a miss', () => {
    const r = monthHealth(
      '2026-07',
      [pub(VERBATIM_1_00), { timestamp: '2026-07-16T00:00:00.000Z', caption: '   ' }],
      [chainOf(VERBATIM_1_00)],
    );
    if (r.state !== 'measured') throw new Error('expected measured');
    expect(r.published).toBe(1);
    expect(r.adoption).toBe(1);
  });
});

describe('asPercent', () => {
  it('keeps one decimal and passes null through', () => {
    expect(asPercent(10 / 36)).toBe(27.8);
    expect(asPercent(1)).toBe(100);
    expect(asPercent(null)).toBeNull();
  });
});
