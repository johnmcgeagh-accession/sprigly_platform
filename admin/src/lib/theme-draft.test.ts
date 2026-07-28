/**
 * theme-draft.test.ts — an operator can create Sprigly Mint, and Teal v1 keeps working.
 *
 * The bug: `admin/themes` had no create form at all, so spec §12b's "create the Sprigly Mint
 * theme in admin → Themes and activate it on uat" named a screen that did not exist. Every row
 * in the table arrived through migration 0079's seed.
 *
 * These pin the three things that make the fix real rather than cosmetic:
 *   1. the form's fields ARE the platform's injected tiers, so the two cannot drift again;
 *   2. the exact Sprigly Mint values from DESIGN.md round-trip and pass the activation gate;
 *   3. a theme WITHOUT the two round-5 tiers — which is every theme stored today — is still
 *      valid, still computes, and still activates.
 */
import { describe, it, expect } from 'vitest';
import { THEME_TOKEN_KEYS, computeThemeContrast, themeActivatable, type ThemeTokens } from '@sprigly/engine/contrast';
import { parseThemeDraft, GROUPED_KEYS, isOptionalToken, HEX } from './theme-draft';

/** DESIGN.md's frontmatter + spec §12b's rollout table, verbatim. */
const SPRIGLY_MINT: Record<string, string> = {
  name: 'Sprigly Mint', version: '1',
  accent100: '#E3F3F0',
  accent500: '#74C1B5',
  accent600: '#4DB0A0',
  accent650: '#43998B',
  accent700: '#327267',
  accent800: '#285C54',
  chrome: '#334155', chromeDeep: '#1E293B', chromeSoft: '#B8BFC9',
  ink: '#23272F', muted: '#5C6470', line: '#8F9296', lineSoft: '#F4F5F6',
  canvas: '#F2F3F5', surface: '#FFFFFF',
  danger: '#B23A2E',
};

/** The row that is ACTIVE in the database right now — 14 keys, no accent-500 or accent-650. */
const TEAL_V1: Record<string, string> = {
  name: 'Teal', version: '2',
  accent600: '#14B8A6', accent700: '#0F766E', accent800: '#0C5F58', accent100: '#E6F7F5',
  ink: '#23272F', muted: '#5C6470', line: '#8F9296', lineSoft: '#F4F5F6', danger: '#B23A2E',
  chrome: '#334155', chromeDeep: '#1E293B', chromeSoft: '#B8BFC9',
  canvas: '#F2F3F5', surface: '#FFFFFF',
};

describe('the form offers every tier the platform injects', () => {
  it('covers THEME_TOKEN_KEYS exactly — no tier an operator cannot set', () => {
    // This is the fence over the original bug's shape: a tier that exists in theme.ts's VAR map
    // and not in the form is one the app silently falls back for, with nothing saying so.
    expect([...GROUPED_KEYS].sort()).toEqual([...THEME_TOKEN_KEYS].sort());
  });

  it('lists each tier once, so nothing is offered twice under two headings', () => {
    expect(new Set(GROUPED_KEYS).size).toBe(GROUPED_KEYS.length);
  });

  it('includes the two round-5 tiers that made this fix necessary', () => {
    expect(GROUPED_KEYS).toContain('accent500');
    expect(GROUPED_KEYS).toContain('accent650');
  });

  it('marks exactly those two optional, and nothing else', () => {
    const optional = THEME_TOKEN_KEYS.filter((k) => isOptionalToken(k));
    expect(optional).toEqual(['accent500', 'accent650']);
  });
});

describe('creating Sprigly Mint', () => {
  const draft = parseThemeDraft(SPRIGLY_MINT);

  it('validates', () => {
    expect(draft.ok).toBe(true);
  });

  it('round-trips every tier, including 500 and 650', () => {
    if (!draft.ok) throw new Error('expected a valid draft');
    expect(draft.name).toBe('Sprigly Mint');
    expect(draft.version).toBe(1);
    for (const key of THEME_TOKEN_KEYS) {
      expect(draft.tokens[key], `${key} did not survive`).toBe(SPRIGLY_MINT[key]);
    }
  });

  it('PASSES the activation gate — accent-800 on accent-100 is 6.67:1', () => {
    if (!draft.ok) throw new Error('expected a valid draft');
    const verdict = themeActivatable(draft.tokens);
    expect(verdict.ok).toBe(true);
    expect(verdict.contrast.tintTextPasses).toBe(true);
    const gate = verdict.contrast.rows.find((r) => r.pair.startsWith('accent-800 on accent-100'));
    expect(gate?.ratio).toBeCloseTo(6.67, 1);
  });

  it('stores a contrast table that REPORTS the white-on-650 deviation without blocking on it', () => {
    if (!draft.ok) throw new Error('expected a valid draft');
    const row = computeThemeContrast(draft.tokens).rows.find((r) => r.pair.includes('accent-650'));
    expect(row?.ratio).toBeCloseTo(3.4, 1);
    expect(row?.passesAA).toBe(false);      // the recorded, component-scoped deviation
    expect(row?.passesLarge).toBe(true);    // still over the 3:1 graphic floor, with margin
    expect(themeActivatable(draft.tokens).ok).toBe(true);
  });
});

describe('a legacy-shaped theme still works — Teal v1 is the ACTIVE row', () => {
  const draft = parseThemeDraft(TEAL_V1);

  it('validates without the two round-5 tiers', () => {
    expect(draft.ok).toBe(true);
  });

  it('OMITS them rather than storing empty strings', () => {
    // An empty string would inject `--t-accent-650:` and resolve to nothing. An absent key is
    // skipped by buildThemeVars and Tailwind's own fallback applies — which is what Teal v1 does
    // today, and must keep doing.
    if (!draft.ok) throw new Error('expected a valid draft');
    expect('accent500' in draft.tokens).toBe(false);
    expect('accent650' in draft.tokens).toBe(false);
    expect(Object.keys(draft.tokens)).toHaveLength(14);
  });

  it('computes a contrast table with no rows for the tiers it does not carry', () => {
    if (!draft.ok) throw new Error('expected a valid draft');
    const rows = computeThemeContrast(draft.tokens).rows;
    expect(rows.some((r) => r.pair.includes('accent-650'))).toBe(false);
    expect(rows.some((r) => r.pair.includes('accent-500'))).toBe(false);
    expect(rows.some((r) => r.pair.startsWith('accent-800 on accent-100'))).toBe(true);
  });

  it('still activates', () => {
    if (!draft.ok) throw new Error('expected a valid draft');
    expect(themeActivatable(draft.tokens).ok).toBe(true);
  });
});

describe('what the form refuses', () => {
  const without = (key: string) => { const v = { ...SPRIGLY_MINT }; delete v[key]; return v; };

  it('a missing REQUIRED tier — a theme without a surface is not a theme', () => {
    const r = parseThemeDraft(without('surface'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors['surface']).toBe('Required.');
  });

  it('a missing OPTIONAL tier is not an error', () => {
    expect(parseThemeDraft(without('accent650')).ok).toBe(true);
  });

  it('anything that is not six-digit hex, because that is all the client can inject', () => {
    // hexToRgbChannels takes exactly /^#[0-9a-fA-F]{6}$/. A shorthand or an rgb() string is
    // accepted by the browser's colour input and injects nothing at all in the app.
    for (const bad of ['#4DB', 'rgb(77,176,160)', '4DB0A0', '#4DB0A0FF', 'mint', '#GGGGGG']) {
      const r = parseThemeDraft({ ...SPRIGLY_MINT, accent600: bad });
      expect(r.ok, `"${bad}" should have been refused`).toBe(false);
      if (!r.ok) expect(r.errors['accent600']).toMatch(/six-digit hex/i);
    }
  });

  it('a nameless or badly-versioned theme', () => {
    expect(parseThemeDraft({ ...SPRIGLY_MINT, name: '  ' }).ok).toBe(false);
    expect(parseThemeDraft({ ...SPRIGLY_MINT, version: '0' }).ok).toBe(false);
    expect(parseThemeDraft({ ...SPRIGLY_MINT, version: '1.5' }).ok).toBe(false);
    expect(parseThemeDraft({ ...SPRIGLY_MINT, version: 'two' }).ok).toBe(false);
  });

  it('collects EVERY bad field, so a form comes back with all of them marked at once', () => {
    const r = parseThemeDraft({ ...SPRIGLY_MINT, name: '', accent600: 'nope', surface: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['accent600', 'name', 'surface']);
  });
});

describe('tidying, not changing', () => {
  it('normalises hex case so the table reads consistently with the seeded rows', () => {
    const r = parseThemeDraft({ ...SPRIGLY_MINT, accent600: '#4db0a0' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tokens.accent600).toBe('#4DB0A0');
  });

  it('trims surrounding whitespace off a pasted value', () => {
    const r = parseThemeDraft({ ...SPRIGLY_MINT, accent650: '  #43998B  ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tokens.accent650).toBe('#43998B');
  });

  it('the shape it validates against is the one the client parses', () => {
    // Same regex, stated in two places; this asserts they agree rather than trusting they do.
    expect(HEX.source).toBe('^#[0-9a-fA-F]{6}$');
  });
});

describe('the gate is unchanged', () => {
  it('still blocks on exactly one pair, and creation does not become a second gate', () => {
    const bad: ThemeTokens = { ...(parseThemeDraft(SPRIGLY_MINT) as { tokens: ThemeTokens }).tokens, accent800: '#8FD9CF' };
    const verdict = themeActivatable(bad);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/accent-800 on accent-100/);

    // …and the draft is still VALID. A theme that will not activate can still be created and
    // looked at; refusing to store it would put a second gate in a second place.
    expect(parseThemeDraft({ ...SPRIGLY_MINT, accent800: '#8FD9CF' }).ok).toBe(true);
  });
});
