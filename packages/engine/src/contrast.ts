/**
 * contrast.ts — WCAG relative-luminance contrast, and the platform-theme contrast gate.
 *
 * A theme is a set of ~15 tokens. The GATE that blocks activation is the tint/text pairing:
 * accent-800 (ink) on accent-100 (tint) — the fill used by beat pills, badges, and the live/
 * confirmed summary — MUST clear AA small-text (≥4.5:1). We also compute the "fills carry text"
 * rule for the accent scale (white on accent-600/700) so admin can surface it and the app can
 * enforce "coral/teal-600 fills carry 14px+/500-weight text only" when white-on-600 is sub-AA.
 */

export interface ThemeTokens {
  accent600: string; accent700: string; accent800: string; accent100: string;
  /**
   * The two tiers the round-5 ramp added, both OPTIONAL — every theme stored before them
   * (Sprigly Coral, Teal v1) lacks both, and requiring them would make those themes
   * un-activatable overnight.
   *
   * accent650 is the filled-control tier: the lightest value on the identity's hue and
   * saturation that still carries WHITE over the 3:1 graphic floor with margin. accent500 is
   * the mark's lighter leaf — non-text vivid, and dark ink on it.
   *
   * Neither is gate-checked. The gate is one pair (accent-800 on accent-100) and these are
   * not it; 650's white pairing is a recorded, component-scoped deviation below AA-normal, so
   * it is REPORTED in the contrast table and never allowed to block. See DESIGN.md.
   */
  accent500?: string; accent650?: string;
  ink: string; muted: string; line: string; lineSoft: string; danger: string;
  chrome: string; chromeDeep: string; chromeSoft: string;
  canvas: string; surface: string;
}

/**
 * Ordered token keys — the ~15, plus the two optional round-5 tiers.
 *
 * THIS IS THE LIST. The client's `theme.ts` VAR map injects exactly these as `--t-*`, and the
 * admin create form offers exactly these as inputs. A tier that is in one and not the others is
 * a tier an operator cannot set and the app therefore falls back for — silently, which is how
 * Sprigly Mint became uncreatable. `theme-var-parity.test.ts` in the app pins the first pairing;
 * the admin form derives its fields from here rather than restating them.
 */
export const THEME_TOKEN_KEYS: (keyof ThemeTokens)[] = [
  'accent500', 'accent600', 'accent650', 'accent700', 'accent800', 'accent100',
  'ink', 'muted', 'line', 'lineSoft', 'danger',
  'chrome', 'chromeDeep', 'chromeSoft', 'canvas', 'surface',
];

/**
 * Tiers a theme MAY omit, and every theme stored before round 5 does.
 *
 * Omission is not a defect: `buildThemeVars` skips a key the theme does not carry, so nothing
 * is injected for it and Tailwind's own fallback applies. Teal v1 and Sprigly Coral both render
 * exactly as they did. Everything else is required — a theme missing `surface` is not a theme.
 */
export const OPTIONAL_THEME_TOKEN_KEYS: readonly (keyof ThemeTokens)[] = ['accent500', 'accent650'];

const HEX = /^#([0-9a-fA-F]{6})$/;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
/** Relative luminance (WCAG) of a #RRGGBB hex. Throws on a malformed hex. */
export function luminance(hex: string): number {
  const m = HEX.exec(hex.trim());
  if (!m?.[1]) throw new Error(`not a #RRGGBB hex: "${hex}"`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** WCAG contrast ratio (1..21), rounded to 2dp. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

export interface ContrastRow { pair: string; ratio: number; passesAA: boolean; passesLarge: boolean }
export interface ThemeContrast {
  rows: ContrastRow[];
  /** True when white small-text on accent-600 is sub-AA → 600 fills carry 14px+/500 text only. */
  accent600FillsLargeTextOnly: boolean;
  /** The GATE: accent-800-on-accent-100 clears AA (≥4.5). Activation is blocked when false. */
  tintTextPasses: boolean;
}

/** Compute the stored contrast table + gate verdict for a theme's tokens. */
export function computeThemeContrast(t: ThemeTokens): ThemeContrast {
  const row = (pair: string, a: string, b: string): ContrastRow => {
    const ratio = contrastRatio(a, b);
    return { pair, ratio, passesAA: ratio >= 4.5, passesLarge: ratio >= 3 };
  };
  const rows: ContrastRow[] = [
    row('white on accent-600', '#FFFFFF', t.accent600),
    // Reported ONLY when the theme carries the tier. An absent row is not a silent pass —
    // it means the theme has no 650, so the app falls back and there is nothing to report.
    ...(t.accent650 ? [row('white on accent-650 (filled controls)', '#FFFFFF', t.accent650)] : []),
    ...(t.accent500 ? [row('chrome-deep on accent-500', t.chromeDeep, t.accent500)] : []),
    row('white on accent-700', '#FFFFFF', t.accent700),
    row('accent-800 on accent-100 (tint/text)', t.accent800, t.accent100),
    row('accent-600 on surface', t.accent600, t.surface),
    row('border on surface', t.line, t.surface),
    row('white on chrome', '#FFFFFF', t.chrome),
    row('chrome-soft on chrome', t.chromeSoft, t.chrome),
  ];
  const tint = rows.find((r) => r.pair.startsWith('accent-800 on accent-100'))!;
  const white600 = rows.find((r) => r.pair === 'white on accent-600')!;
  return { rows, accent600FillsLargeTextOnly: !white600.passesAA, tintTextPasses: tint.passesAA };
}

/** The activation gate: a theme whose tint/text pairing fails AA may NOT be activated. */
export function themeActivatable(t: ThemeTokens): { ok: boolean; reason?: string; contrast: ThemeContrast } {
  const contrast = computeThemeContrast(t);
  if (!contrast.tintTextPasses) {
    const r = contrast.rows.find((x) => x.pair.startsWith('accent-800 on accent-100'))!;
    return { ok: false, reason: `accent-800 on accent-100 is ${r.ratio}:1 — below the 4.5:1 AA floor for tinted text`, contrast };
  }
  return { ok: true, contrast };
}
