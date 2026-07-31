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
