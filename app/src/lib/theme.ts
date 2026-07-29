/**
 * theme.ts — resolve the ACTIVE platform theme (admin-managed, global) into CSS variables that
 * the layout injects at :root. Tailwind tokens read these vars (RGB channels), so switching the
 * active theme in admin repaints the app on the next load with NO rebuild. On any DB failure we
 * inject nothing and the Tailwind fallbacks ("Sprigly Coral") apply — byte-identical.
 */
import { db, themes } from '@sprigly/db';
import { eq } from 'drizzle-orm';

/**
 * token key → CSS custom property.
 *
 * EXPORTED so `theme.test.ts` can assert it against `THEME_TOKEN_KEYS`. The two lists are the
 * same contract read from two ends — this map decides what gets injected, and the admin create
 * form derives its inputs from `THEME_TOKEN_KEYS`. A tier in one and not the other is a tier an
 * operator cannot set and the app silently falls back for, which is exactly how Sprigly Mint
 * became uncreatable.
 */
export const VAR: Record<string, string> = {
  // accent500 / accent650 are the round-5 ramp's two extra tiers. Optional on the theme row:
  // buildThemeVars skips any key the theme does not carry, so a theme without them injects
  // nothing for them and Tailwind's fallback applies — which is exactly the pre-ramp render.
  accent500: '--t-accent-500', accent650: '--t-accent-650',
  accent600: '--t-accent-600', accent700: '--t-accent-700', accent800: '--t-accent-800', accent100: '--t-accent-100',
  ink: '--t-ink', muted: '--t-muted', line: '--t-line', lineSoft: '--t-line-soft', danger: '--t-danger',
  chrome: '--t-chrome', chromeDeep: '--t-chrome-deep', chromeSoft: '--t-chrome-soft', canvas: '--t-canvas', surface: '--t-surface',
};

/** '#E8705F' → '232 112 95' (space-separated channels, for rgb(var(...) / <alpha>)). Null if malformed. */
export function hexToRgbChannels(hex: string): string | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec((hex ?? '').trim());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Build the `:root { --t-*: r g b; … }` CSS for a theme's tokens (only well-formed hexes). */
export function buildThemeVars(tokens: Record<string, string>): string {
  const decls: string[] = [];
  for (const [key, cssVar] of Object.entries(VAR)) {
    const rgb = hexToRgbChannels(tokens[key] ?? '');
    if (rgb) decls.push(`${cssVar}:${rgb}`);
  }
  return decls.length ? `:root{${decls.join(';')}}` : '';
}

/**
 * The canvas colour Tailwind's `bg-bg` falls back to. Kept here as a hex because `theme-color`
 * is the one consumer that cannot read a CSS variable — Safari resolves the meta tag before any
 * stylesheet, so the band has to be given a literal.
 *
 * It must equal `tailwind.config.ts`'s `--t-canvas` fallback (242 243 245); `theme.test.ts`
 * asserts the two agree, because a drift here shows up as a hairline of the wrong colour under
 * the status bar and nowhere else.
 */
export const CANVAS_FALLBACK_HEX = '#F2F3F5';

/**
 * The brand `theme-color` from DECISIONS.md §13 — still what the legacy `PlanApp` surface and
 * the expired page hand Safari's chrome bands. Only the redesign departs from it, and only
 * because its bands have a canvas to match; see `generateViewport` in app/page.tsx.
 */
export const CORAL_THEME_COLOR = '#E8705F';

/** The active theme's tokens, or null when there is no active theme / the DB is unreachable
 *  (the caller then injects nothing → Tailwind's Sprigly-Coral fallbacks render byte-identically). */
export async function loadActiveThemeVars(): Promise<string> {
  try {
    const [row] = await db.select({ tokens: themes.tokens }).from(themes).where(eq(themes.isActive, true)).limit(1);
    if (!row?.tokens) return '';
    return buildThemeVars(row.tokens as Record<string, string>);
  } catch {
    return '';
  }
}

/**
 * The active theme's canvas as a hex, for `theme-color`.
 *
 * Resolved from the same row the vars come from, so the Safari band and `bg-bg` cannot disagree
 * after an admin theme switch. Any failure — no active theme, a malformed hex, the DB down —
 * returns the fallback, which is what the page would paint anyway.
 */
export async function loadActiveCanvasHex(): Promise<string> {
  try {
    const [row] = await db.select({ tokens: themes.tokens }).from(themes).where(eq(themes.isActive, true)).limit(1);
    const hex = (row?.tokens as Record<string, string> | undefined)?.['canvas'] ?? '';
    return hexToRgbChannels(hex) ? hex.trim() : CANVAS_FALLBACK_HEX;
  } catch {
    return CANVAS_FALLBACK_HEX;
  }
}
