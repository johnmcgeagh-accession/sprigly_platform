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
