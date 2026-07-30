'use client';

/**
 * theme-color.ts — the browser chrome follows the sheet (F7c).
 *
 * `theme-color` paints Safari's status-bar band. The page sets it to the CANVAS
 * (page.tsx → generateViewport), which is right until a sheet opens: the scrim dims the whole
 * app to canvas-under-34%-chrome-deep while the band above it stays bright canvas — a
 * mismatched stripe across the top of every overlay. (The BOTTOM band needs no meta: the sheet
 * itself runs under the home indicator with its own `bg-surface`, so the bottom already adopts
 * the sheet surface.)
 *
 * So the meta follows the scrim: while ANY sheet is up, every `theme-color` meta is set to the
 * scrim tone — the canvas blended with `chrome-deep` at the scrim's own alpha — and restored
 * when the last sheet closes. A counter, not a boolean, because sheets stack (Move opens over
 * the detail sheet) and the first close must not restore the band under the sheet still open.
 *
 * The tones are READ, not restated: the base from the meta the server wrote (so an admin theme
 * switch carries through), chrome-deep from its own CSS token. One source each, nothing to
 * drift.
 */

/** The scrim's alpha — must match the Sheet scrim (`bg-chrome-deep/[.34]`). */
const SCRIM_ALPHA = 0.34;

/** '#RRGGBB' blended toward an [r,g,b] at `alpha`. Exported pure for the tests. */
export function blendHex(baseHex: string, over: readonly [number, number, number], alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(baseHex.trim());
  if (!m) return baseHex;
  const n = parseInt(m[1]!, 16);
  const mix = (base: number, top: number) => Math.round(base * (1 - alpha) + top * alpha);
  const [r, g, b] = [mix((n >> 16) & 255, over[0]), mix((n >> 8) & 255, over[1]), mix(n & 255, over[2])];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** chrome-deep as [r,g,b], from the live token (tailwind.config.ts fallback mirrored). */
function chromeDeep(): [number, number, number] {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--t-chrome-deep').trim();
    const parts = raw.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) return [parts[0]!, parts[1]!, parts[2]!];
  } catch { /* fall through to the token's own fallback */ }
  return [30, 41, 59];
}

let openSheets = 0;
let saved: { el: HTMLMetaElement; content: string }[] = [];

/** A sheet opened. First one dims the band; the rest just count. */
export function sheetThemeOpened(): void {
  if (typeof document === 'undefined') return;
  openSheets += 1;
  if (openSheets > 1) return;
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  saved = metas.map((el) => ({ el, content: el.content }));
  const deep = chromeDeep();
  for (const { el, content } of saved) el.content = blendHex(content, deep, SCRIM_ALPHA);
}

/** A sheet closed. The last one restores what the server wrote. */
export function sheetThemeClosed(): void {
  if (typeof document === 'undefined') return;
  openSheets = Math.max(0, openSheets - 1);
  if (openSheets > 0) return;
  for (const { el, content } of saved) el.content = content;
  saved = [];
}
