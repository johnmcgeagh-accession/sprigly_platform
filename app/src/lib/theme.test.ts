/** theme var-builder + active-theme loader — hex→channels, the :root CSS block, and the switch. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rows: [] as { tokens: Record<string, string> }[], throws: false }));
vi.mock('@sprigly/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (h.throws) throw new Error('db down'); return h.rows; } }) }) }) },
  themes: { tokens: 'tokens', isActive: 'is_active' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => 'eq' }));

import { THEME_TOKEN_KEYS } from '@sprigly/engine/contrast';
import { hexToRgbChannels, buildThemeVars, loadActiveThemeVars, VAR } from './theme';

const TEAL = { accent600: '#14B8A6', accent700: '#0F766E', accent800: '#0C5F58', accent100: '#E6F7F5', canvas: '#F2F3F5', surface: '#FFFFFF', line: '#8F9296', chrome: '#334155' };

beforeEach(() => { h.rows = []; h.throws = false; });

describe('hexToRgbChannels', () => {
  it('converts #RRGGBB to space-separated channels', () => {
    expect(hexToRgbChannels('#E8705F')).toBe('232 112 95');
    expect(hexToRgbChannels('#14B8A6')).toBe('20 184 166');
  });
  it('returns null for a malformed hex', () => {
    expect(hexToRgbChannels('nope')).toBeNull();
    expect(hexToRgbChannels('#FFF')).toBeNull();
  });
});

describe('buildThemeVars', () => {
  it('emits :root vars only for well-formed hex tokens', () => {
    const css = buildThemeVars({ accent600: '#14B8A6', canvas: '#F2F3F5', line: 'bogus' });
    expect(css).toContain('--t-accent-600:20 184 166');
    expect(css).toContain('--t-canvas:242 243 245');
    expect(css).not.toContain('--t-line');
    expect(css.startsWith(':root{')).toBe(true);
  });
  it('empty when no tokens valid (→ Tailwind fallbacks render byte-identically)', () => {
    expect(buildThemeVars({})).toBe('');
  });
});

describe('loadActiveThemeVars (the switch)', () => {
  it('returns the ACTIVE theme’s vars — switching the active row repaints the app', async () => {
    h.rows = [{ tokens: TEAL }];
    const css = await loadActiveThemeVars();
    expect(css).toContain('--t-accent-600:20 184 166');   // teal, not coral
    expect(css).toContain('--t-chrome:51 65 85');
  });
  it('no active theme → empty string (Tailwind coral fallbacks apply)', async () => {
    h.rows = [];
    expect(await loadActiveThemeVars()).toBe('');
  });
  it('DB failure → empty string (never throws; fallbacks render)', async () => {
    h.throws = true;
    expect(await loadActiveThemeVars()).toBe('');
  });
});

describe('the injected tiers and the settable tiers are the same list', () => {
  it('VAR covers THEME_TOKEN_KEYS exactly', () => {
    // Read from both ends: this map decides what is injected as --t-*, and the admin create form
    // derives its inputs from THEME_TOKEN_KEYS. A tier in one and not the other is one an
    // operator cannot set and the app silently falls back for — which is the whole bug.
    expect(Object.keys(VAR).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
  });

  it('every custom property is --t-<kebab-key>, so the name cannot drift from the key', () => {
    for (const [key, cssVar] of Object.entries(VAR)) {
      const expected = `--t-${key.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()}`;
      expect(cssVar, `${key} injects ${cssVar}`).toBe(expected);
    }
  });

  it('a theme WITHOUT the two optional tiers injects nothing for them', () => {
    // Teal v1's shape. Nothing is emitted, so Tailwind's own fallback applies and the app renders
    // exactly as it did before the ramp gained them.
    const css = buildThemeVars(TEAL);
    expect(css).not.toContain('--t-accent-500');
    expect(css).not.toContain('--t-accent-650');
    expect(css).toContain('--t-accent-600:20 184 166');
  });

  it('a theme WITH them injects both', () => {
    const css = buildThemeVars({ ...TEAL, accent500: '#74C1B5', accent650: '#43998B' });
    expect(css).toContain('--t-accent-500:116 193 181');
    expect(css).toContain('--t-accent-650:67 153 139');
  });
});
