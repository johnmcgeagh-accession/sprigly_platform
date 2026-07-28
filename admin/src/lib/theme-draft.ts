/**
 * theme-draft.ts — turning a filled-in form into a theme row, or into errors.
 *
 * Pure, and in its own module so it can be tested without a database. The server action does the
 * three things only a server can (uniqueness, insert, revalidate); everything that can be wrong
 * about a theme before it reaches the table is decided here.
 *
 * ── The fields come from the platform, not from this file ────────────────────────────
 *
 * `THEME_TOKEN_KEYS` is the list `app/src/lib/theme.ts` injects as `--t-*` custom properties.
 * Deriving the form from it is the whole point of this fix: the reason Sprigly Mint could not be
 * created is that the Themes page had no create form at all, and the failure mode a hand-written
 * one would have re-introduced is a field list that drifts from the injected list — an operator
 * sets what the form offers, the app falls back for the rest, and nothing says so.
 */
import { THEME_TOKEN_KEYS, OPTIONAL_THEME_TOKEN_KEYS, type ThemeTokens } from '@sprigly/engine/contrast';

/** The token contract, unchanged: `#RRGGBB`. Matches `contrast.ts`'s HEX and `theme.ts`'s
 *  hexToRgbChannels, both of which accept exactly six hex digits and nothing else — a 3-digit
 *  shorthand or an `rgb()` string reaches the client and injects nothing. */
export const HEX = /^#[0-9a-fA-F]{6}$/;

export type TokenKey = keyof ThemeTokens;

const OPTIONAL = new Set<string>(OPTIONAL_THEME_TOKEN_KEYS as readonly string[]);
export const isOptionalToken = (k: string): boolean => OPTIONAL.has(k);

/** Presentation only — grouping and a one-line note per tier, so the form reads as the ramp it
 *  is rather than as sixteen anonymous colour pickers. Every key here comes FROM
 *  THEME_TOKEN_KEYS; nothing is added to the list, only described. */
export const TOKEN_NOTES: Partial<Record<TokenKey, string>> = {
  accent500: 'the mark’s lighter leaf — non-text vivid, takes dark ink',
  accent600: 'the identity tone. Non-text only: dots, glow, waveform',
  accent650: 'filled controls — the tier that carries white',
  accent700: 'dense-text surfaces',
  accent800: 'accent text. Gate-checked against accent-100',
  accent100: 'tint. Gate-checked against accent-800',
  danger:    'destructive actions only',
  line:      'hairlines',
  surface:   'cards and sheets',
  canvas:    'the page behind everything',
};

export const TOKEN_GROUPS: { title: string; keys: TokenKey[] }[] = [
  { title: 'Accent ramp', keys: ['accent100', 'accent500', 'accent600', 'accent650', 'accent700', 'accent800'] },
  { title: 'Chrome',      keys: ['chrome', 'chromeDeep', 'chromeSoft'] },
  { title: 'Neutrals',    keys: ['ink', 'muted', 'line', 'lineSoft', 'canvas', 'surface'] },
  { title: 'Status',      keys: ['danger'] },
];

/** Every key the platform injects appears in exactly one group. Asserted by test, because a key
 *  added to THEME_TOKEN_KEYS and not to a group would silently vanish from the form — which is
 *  the exact bug this module exists to make impossible. */
export const GROUPED_KEYS: TokenKey[] = TOKEN_GROUPS.flatMap((g) => g.keys);

export type ThemeDraft =
  | { ok: true; name: string; version: number; tokens: ThemeTokens }
  | { ok: false; errors: Record<string, string> };

/**
 * Validate a submitted form.
 *
 * @param raw field name → value, straight off the FormData. Missing keys read as empty.
 *
 * A required tier must be a well-formed hex. An optional tier is either a well-formed hex or
 * genuinely ABSENT — a blank one is omitted from the stored object rather than written as `''`,
 * so a theme without `accent650` looks exactly like Teal v1 does today and the client falls back
 * for it, instead of injecting an empty custom property that resolves to nothing.
 */
export function parseThemeDraft(raw: Record<string, string | undefined>): ThemeDraft {
  const errors: Record<string, string> = {};
  const get = (k: string) => (raw[k] ?? '').trim();

  const name = get('name');
  if (!name) errors['name'] = 'Give the theme a name.';
  else if (name.length > 60) errors['name'] = 'Keep the name under 60 characters.';

  const versionRaw = get('version') || '1';
  const version = Number(versionRaw);
  if (!Number.isInteger(version) || version < 1) errors['version'] = 'Version must be a whole number, 1 or more.';

  const tokens: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) {
    const v = get(key);
    if (!v) {
      if (!isOptionalToken(key)) errors[key] = 'Required.';
      continue;                                    // optional + blank → omitted, not stored empty
    }
    if (!HEX.test(v)) { errors[key] = 'Six-digit hex, like #4DB0A0.'; continue; }
    // Stored uppercase so the table reads consistently with the seeded rows. The client's
    // hexToRgbChannels is case-insensitive, so this changes nothing about what renders.
    tokens[key] = `#${v.slice(1).toUpperCase()}`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, name, version, tokens: tokens as unknown as ThemeTokens };
}
