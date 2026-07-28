import { describe, it, expect } from 'vitest';
import { contrastRatio, computeThemeContrast, themeActivatable, type ThemeTokens } from './contrast.js';

const NEUTRAL = { ink: '#23272F', muted: '#5C6470', line: '#8F9296', lineSoft: '#F4F5F6', danger: '#B23A2E', chrome: '#334155', chromeDeep: '#1E293B', chromeSoft: '#B8BFC9', canvas: '#F2F3F5', surface: '#FFFFFF' };
const CORAL: ThemeTokens = { accent600: '#E8705F', accent700: '#C4523F', accent800: '#8A3323', accent100: '#FADDD6', ...NEUTRAL };
const TEAL:  ThemeTokens = { accent600: '#14B8A6', accent700: '#0F766E', accent800: '#0C5F58', accent100: '#E6F7F5', ...NEUTRAL };
const BAD:   ThemeTokens = { accent600: '#14B8A6', accent700: '#0F766E', accent800: '#8FD9CF', accent100: '#E6F7F5', ...NEUTRAL };

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(contrastRatio('#FFFFFF', '#E8705F')).toBeCloseTo(3.04, 1);   // white on coral-600
    expect(contrastRatio('#8A3323', '#FADDD6')).toBeCloseTo(6.35, 1);   // coral tint/text
  });
  it('is symmetric and throws on a bad hex', () => {
    expect(contrastRatio('#E8705F', '#FFFFFF')).toBe(contrastRatio('#FFFFFF', '#E8705F'));
    expect(() => contrastRatio('nope', '#FFFFFF')).toThrow();
  });
});

describe('computeThemeContrast', () => {
  it('coral: tint/text passes AA, and accent-600 white text is large-only', () => {
    const c = computeThemeContrast(CORAL);
    expect(c.tintTextPasses).toBe(true);
    expect(c.accent600FillsLargeTextOnly).toBe(true);   // white on coral-600 = 3.04 (sub-AA small)
  });
});

// The round-5 ramp, quoted from spec §12b. Sprigly Mint is the theme the operator creates and
// activates; this file only has to prove the platform will let them.
const MINT: ThemeTokens = {
  accent500: '#74C1B5', accent600: '#4DB0A0', accent650: '#43998B',
  accent700: '#327267', accent800: '#285C54', accent100: '#E3F3F0', ...NEUTRAL,
};

describe('the two optional round-5 tiers', () => {
  it('a theme without them computes exactly as before — no row, no verdict change', () => {
    const c = computeThemeContrast(TEAL);
    expect(c.rows.some((r) => r.pair.includes('accent-650'))).toBe(false);
    expect(c.rows.some((r) => r.pair.includes('accent-500'))).toBe(false);
    expect(c.tintTextPasses).toBe(true);
  });

  it('reports white-on-650 when the theme carries it, so the deviation is visible where the decision is made', () => {
    // Round 5.1 recorded that admin's table would not mention 650 and that it should when the
    // token landed. This is that. 3.40 is below AA-normal on purpose (DESIGN.md, the ink rule).
    const row = computeThemeContrast(MINT).rows.find((r) => r.pair.includes('accent-650'));
    expect(row?.ratio).toBeCloseTo(3.4, 1);
    expect(row?.passesAA).toBe(false);
    expect(row?.passesLarge).toBe(true);     // clears the 3:1 graphic floor, with margin
  });

  it('does NOT let the deviation block activation — the gate is one pair, and 650 is not it', () => {
    const v = themeActivatable(MINT);
    expect(v.ok).toBe(true);
    expect(contrastRatio(MINT.accent800, MINT.accent100)).toBeCloseTo(6.67, 1);
  });

  it('reports chrome-deep on accent-500, the pairing that lets the vivid tier be loud', () => {
    const row = computeThemeContrast(MINT).rows.find((r) => r.pair.includes('accent-500'));
    expect(row?.ratio).toBeCloseTo(6.99, 1);
    expect(row?.passesAA).toBe(true);
  });
});

describe('themeActivatable (the gate)', () => {
  it('activates coral and teal (both tint/text ≥ 4.5)', () => {
    expect(themeActivatable(CORAL).ok).toBe(true);
    expect(themeActivatable(TEAL).ok).toBe(true);
  });
  it('BLOCKS a theme whose accent-800-on-accent-100 fails AA', () => {
    const v = themeActivatable(BAD);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/accent-800 on accent-100/);
    expect(v.contrast.tintTextPasses).toBe(false);
  });
});
