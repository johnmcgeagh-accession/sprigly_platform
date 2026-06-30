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
});
