/** theme var-builder + active-theme loader — hex→channels, the :root CSS block, and the switch. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rows: [] as { tokens: Record<string, string> }[], throws: false }));
vi.mock('@sprigly/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (h.throws) throw new Error('db down'); return h.rows; } }) }) }) },
  themes: { tokens: 'tokens', isActive: 'is_active' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => 'eq' }));

import { THEME_TOKEN_KEYS } from '@sprigly/engine/contrast';
import { hexToRgbChannels, buildThemeVars, loadActiveThemeVars, loadActiveCanvasHex, CANVAS_FALLBACK_HEX, VAR } from './theme';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * ── The Safari chrome bands (round 8, fix 3) ─────────────────────────────────────────
 *
 * `theme-color` is the one consumer that cannot read a CSS variable: Safari resolves the meta
 * tag before any stylesheet, so it has to be handed a literal. That literal is the canvas, and
 * the whole point of the fix is that the bands and `bg-bg` are the same colour — which means
 * this resolver and Tailwind's fallback must not be allowed to drift apart. A drift here shows
 * up as a hairline of the wrong colour under the status bar and nowhere else on the surface.
 */
describe('loadActiveCanvasHex (what Safari paints its bands)', () => {
  it('follows the ACTIVE theme, so a theme switch carries the bands with the canvas', async () => {
    h.rows = [{ tokens: TEAL }];
    expect(await loadActiveCanvasHex()).toBe('#F2F3F5');
    h.rows = [{ tokens: { ...TEAL, canvas: '#101418' } }];
    expect(await loadActiveCanvasHex()).toBe('#101418');
  });

  it('no active theme → the fallback, which is what the page paints anyway', async () => {
    h.rows = [];
    expect(await loadActiveCanvasHex()).toBe(CANVAS_FALLBACK_HEX);
  });

  it('DB down → the fallback. The bands are never left to Safari to guess', async () => {
    h.throws = true;
    expect(await loadActiveCanvasHex()).toBe(CANVAS_FALLBACK_HEX);
  });

  it('a malformed canvas is refused rather than emitted into a meta tag', async () => {
    h.rows = [{ tokens: { ...TEAL, canvas: 'rebeccapurple' } }];
    expect(await loadActiveCanvasHex()).toBe(CANVAS_FALLBACK_HEX);
  });

  it('THE FALLBACK EQUALS TAILWIND’S --t-canvas fallback, read from the config itself', () => {
    const cfg = readFileSync(join(process.cwd(), 'tailwind.config.ts'), 'utf8');
    const m = /--t-canvas',\s*'(\d+) (\d+) (\d+)'/.exec(cfg);
    expect(m, 'tailwind.config.ts no longer declares a --t-canvas fallback').toBeTruthy();
    const hex = `#${[m![1], m![2], m![3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    expect(hex).toBe(CANVAS_FALLBACK_HEX);
  });
});
