import { describe, it, expect } from 'vitest';
import { computeCostPence } from './price-map.js';

describe('computeCostPence', () => {
  it('returns 0 for unknown model', () => {
    expect(computeCostPence('unknown-model', 1000, 500)).toBe(0);
  });

  it('returns a non-negative integer for claude-sonnet-4-6', () => {
    const result = computeCostPence('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
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

  describe('titan embeddings', () => {
    const TITAN = 'amazon.titan-embed-text-v2:0';

    it('is priced at all — an embed is never a fake 0', () => {
      // A query embed is a few dozen tokens. Tiny, but not free, and not unpriced.
      // (How MUCH it costs cannot be asserted yet: Math.ceil rounds every non-zero to 1p.)
      expect(computeCostPence(TITAN, 60, 0)).toBeGreaterThan(0);
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
