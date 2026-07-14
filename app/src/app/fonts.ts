import { Fraunces, Inter, Plus_Jakarta_Sans } from 'next/font/google';

/**
 * Self-hosted brand fonts for the redesign (next/font downloads + serves them at build —
 * no runtime Google request). Matched to the marketing site (sprigly.co.uk) exactly:
 *   · Fraunces — the display serif (variable SOFT + opsz axes, normal + italic). Powers every
 *     `font-serif` display moment; the italic swash uses `.fraunces-soft` ("SOFT" 100, opsz 144).
 *   · Inter — the body / UI sans (`font-serif` → this). The site's default `font-sans`.
 *   · Plus Jakarta Sans 800 — the LOGO wordmark only (`font-logo`), as on the site's nav.
 * Applied as CSS variables on the PlanRedesign root; Tailwind maps font-serif/sans/logo to them.
 * `display: 'swap'` so headings reliably render the brand serif; next/font's automatic
 * size-adjusted fallback (adjustFontFallback, on by default) keeps the swap from janking.
 */
export const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['SOFT', 'opsz'],
});

export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['800'],
  variable: '--font-jakarta',
  display: 'swap',
});
