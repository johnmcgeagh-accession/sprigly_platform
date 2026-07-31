import { describe, it, expect } from 'vitest';
import { computeCostPence } from './price-map.js';

describe('computeCostPence', () => {
  it('returns 0 for unknown model', () => {
    expect(computeCostPence('unknown-model', 1000, 500)).toBe(0);
  });

  it('returns a non-negative number for claude-sonnet-4-6', () => {
    const result = computeCostPence('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(result).toBeGreaterThan(0);
  });

  it('returns more for opus than sonnet at same token count', () => {
    const opus = computeCostPence('claude-opus-4-7', 1_000_000, 1_000_000);
    const sonnet = computeCostPence('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(opus).toBeGreaterThan(sonnet);
  });

  it('scales linearly with input token count', () => {
    const single = computeCostPence('claude-sonnet-4-6', 1_000_000, 0);
    const double = computeCostPence('claude-sonnet-4-6', 2_000_000, 0);
    expect(double).toBe(single * 2);
  });

  // ── The rounding fix (migration 0091) ──────────────────────────────────────────────────
  //
  // These are the cases the old Math.ceil could not express. Each one asserts the SHAPE of the
  // answer (a real fraction, not 0 and not 1), because the exact figure moves whenever the rate
  // table is updated and a test pinned to it would just be a second copy of the table.

  describe('sub-penny precision', () => {
    it('a typical Haiku parse turn costs a FRACTION of a penny, not a whole one', () => {
      // ~4.5k in / ~250 out — the real shape of one conversational parse call.
      const cost = computeCostPence('eu.anthropic.claude-haiku-4-5-20251001-v1:0', 4_500, 250);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(1);          // Math.ceil returned 1 here
    });

    it('does not round UP — a cost below half a penny stays below half a penny', () => {
      const cost = computeCostPence('eu.anthropic.claude-haiku-4-5-20251001-v1:0', 1_000, 100);
      expect(cost).toBeLessThan(0.5);
    });

    it('carries six decimal places (micropence) and no float noise', () => {
      const cost = computeCostPence('eu.anthropic.claude-haiku-4-5-20251001-v1:0', 4_321, 123);
      expect(String(cost).replace(/^\d*\.?/, '').length).toBeLessThanOrEqual(6);
    });
  });

  /**
   * CACHE-AWARE PRICING, asserted against the real shapes from the W2 live run.
   *
   * These three rows are not invented: they are what Bedrock reported for three consecutive
   * turns through the parser on 2026-07-31 (docs/reports/conversational-cost.md, W2). Every
   * expectation below is hand-computed from the published multipliers rather than read back
   * out of the implementation, which is the only way a pricing test can fail usefully — a test
   * that recomputes the formula would agree with any formula, including a wrong one.
   *
   * Haiku on Bedrock: 69p per 1M input, 368p per 1M output. Cache read 0.1× input, cache
   * write 1.25× input (five-minute TTL, which is what `cachePoint: {type:'default'}` creates).
   */
  describe('prompt-cache economics', () => {
    const HAIKU = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

    it('turn 1 of the live run: 25 in + 109 out + 5,712 cache WRITE', () => {
      //   input  25 / 1e6 × 69          = 0.001725
      //   output 109 / 1e6 × 368        = 0.040112
      //   write  5712 / 1e6 × 69 × 1.25 = 0.492660
      //                                   ----------
      //                                   0.534497
      expect(computeCostPence(HAIKU, 25, 109, { cacheWriteTokens: 5712 })).toBe(0.534497);
    });

    it('turn 2 of the live run: 63 in + 88 out + 5,712 cache READ', () => {
      //   input  63 / 1e6 × 69         = 0.004347
      //   output 88 / 1e6 × 368        = 0.032384
      //   read   5712 / 1e6 × 69 × 0.1 = 0.039413
      //                                  ----------
      //                                  0.076144
      expect(computeCostPence(HAIKU, 63, 88, { cacheReadTokens: 5712 })).toBe(0.076144);
    });

    it('turn 3 of the live run: 88 in + 95 out + 5,712 cache READ', () => {
      expect(computeCostPence(HAIKU, 88, 95, { cacheReadTokens: 5712 })).toBe(0.080445);
    });

    it('a cache READ costs a tenth of what the same tokens cost uncached', () => {
      const uncached = computeCostPence(HAIKU, 5712, 0);
      const cached   = computeCostPence(HAIKU, 0, 0, { cacheReadTokens: 5712 });
      expect(cached).toBeCloseTo(uncached * 0.1, 6);
    });

    it('a cache WRITE costs a quarter MORE than the same tokens uncached — it is a premium', () => {
      const uncached = computeCostPence(HAIKU, 5712, 0);
      const written  = computeCostPence(HAIKU, 0, 0, { cacheWriteTokens: 5712 });
      expect(written).toBeCloseTo(uncached * 1.25, 6);
      expect(written).toBeGreaterThan(uncached);
    });

    it('cache tokens ADD to the bill — they are disjoint from inputTokens, not part of it', () => {
      const withoutCache = computeCostPence(HAIKU, 63, 88);
      const withCache    = computeCostPence(HAIKU, 63, 88, { cacheReadTokens: 5712 });
      expect(withCache).toBeGreaterThan(withoutCache);
      // The old behaviour, kept explicit: pricing inputTokens alone posted this turn at 0.036731p
      // against a true 0.076144p — 51.8% light on a read turn, and 92.2% light on a write turn.
      expect(withoutCache).toBe(0.036731);
    });

    it('caching still beats not caching, which is the whole point', () => {
      // The same turn without a cache would have sent all 5,775 tokens at full price.
      const uncachedTurn = computeCostPence(HAIKU, 5775, 88);
      const cachedTurn   = computeCostPence(HAIKU, 63, 88, { cacheReadTokens: 5712 });
      expect(cachedTurn).toBeLessThan(uncachedTurn);
      expect(uncachedTurn).toBe(0.430859);
    });

    it('omitting cache tokens prices exactly as before — uncached callers are untouched', () => {
      expect(computeCostPence(HAIKU, 4_500, 250))
        .toBe(computeCostPence(HAIKU, 4_500, 250, {}));
      expect(computeCostPence(HAIKU, 4_500, 250, { cacheReadTokens: 0, cacheWriteTokens: 0 }))
        .toBe(computeCostPence(HAIKU, 4_500, 250));
    });

    it('an unknown model is still free of charge, cache tokens or not', () => {
      expect(computeCostPence('unknown-model', 10, 10, { cacheReadTokens: 9_999 })).toBe(0);
    });
  });

  describe('titan embeddings', () => {
    const TITAN = 'amazon.titan-embed-text-v2:0';

    it('is priced at all — an embed is never a fake 0', () => {
      // A query embed is a few dozen tokens. Tiny, but not free, and not unpriced.
      expect(computeCostPence(TITAN, 60, 0)).toBeGreaterThan(0);
    });

    it('costs fractions of a penny per call, not whole pence', () => {
      expect(computeCostPence(TITAN, 60, 0)).toBeLessThan(0.001);
    });

    it('is orders of magnitude cheaper than a Haiku turn — the ledger can tell them apart', () => {
      const embed = computeCostPence(TITAN, 60, 0);
      const parse = computeCostPence('eu.anthropic.claude-haiku-4-5-20251001-v1:0', 4_500, 250);
      expect(parse / embed).toBeGreaterThan(1_000);   // both posted as 1p before 0091
    });

    it('has no output-token cost — embeddings return a vector, not tokens', () => {
      expect(computeCostPence(TITAN, 100, 0)).toBe(computeCostPence(TITAN, 100, 5_000));
    });

    it('prices the same whichever way the id is classified (Titan has no cross-region profile)', () => {
      expect(computeCostPence('eu.amazon.titan-embed-text-v2:0', 1_000, 0))
        .toBe(computeCostPence(TITAN, 1_000, 0));
    });
  });
});
