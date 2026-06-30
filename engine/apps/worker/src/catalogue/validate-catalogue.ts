/**
 * validate-catalogue.ts — HARD grounding for the planner.
 *
 * After generation, code-validate every product name + colourway mentioned in a
 * caption against the cached catalogue: a named colourway must be a real variant
 * of that product. An invalid pairing (e.g. "Elle in dark olive" — Elle only
 * exists in Black/Navy/Navy Stripe) is rewritten to a neutral "[confirm colourway]"
 * placeholder and explained in Sprigly Notes, rather than shipping a fabrication.
 *
 * Validation is per NAME (union of colourways across all of that name's families/
 * styles), because captions name the product, rarely the style. Proximity-bound:
 * a colourway is only checked against a product name within `windowChars` and on
 * the same line, so generic colour usage ("the navy that goes with everything")
 * isn't flagged.
 */

import type { Catalogue, ProductFamily } from './parse-catalogue.js';

export interface CatalogueIndex {
  /** product name (lower) → set of its valid colourways (lower) across all families */
  colourwaysByName: Map<string, Set<string>>;
  names:      string[];   // product names to match (ambiguous/brand names excluded)
  colourways: string[];   // distinct colourway phrases, longest-first
}

// Names that collide with the brand or with common caption words — never matched
// as products (avoids false positives). "ivy" is the brand itself.
const AMBIGUOUS_NAMES = new Set(['ivy']);

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function indexCatalogue(cat: Catalogue): CatalogueIndex {
  const colourwaysByName = new Map<string, Set<string>>();
  const colourSet = new Set<string>();
  for (const fam of cat.families) {
    const name = fam.name.toLowerCase().trim();
    if (AMBIGUOUS_NAMES.has(name)) continue;
    let set = colourwaysByName.get(name);
    if (!set) { set = new Set(); colourwaysByName.set(name, set); }
    for (const v of fam.variants) {
      const c = (v.colourway ?? '').toLowerCase().trim();
      if (!c) continue;
      set.add(c); colourSet.add(c);
      // Compound colourways (e.g. Nicola's "vintage navy / ecru raglan"): also
      // register each slash-separated COMPONENT as valid for this product and as a
      // recognised colourway phrase. A caption naming one part ("Nicola in Vintage
      // Navy", "Nicola in Ecru Raglan") is correct and must not be flagged.
      if (c.includes('/')) {
        for (const part of c.split('/')) {
          const p = part.trim();
          if (p) { set.add(p); colourSet.add(p); }
        }
      }
    }
  }
  return {
    colourwaysByName,
    names: [...colourwaysByName.keys()],
    colourways: [...colourSet].sort((a, b) => b.length - a.length), // longest-first
  };
}

export interface CaptionViolation { name: string; colourway: string; valid: string[]; }

interface Span { text: string; start: number; end: number; }

export function validateText(text: string, idx: CatalogueIndex, windowChars = 28): CaptionViolation[] {
  const lower = text.toLowerCase();

  const nameHits: Span[] = [];
  for (const n of idx.names) {
    const re = new RegExp('\\b' + escapeRe(n) + '\\b', 'g');
    for (let m; (m = re.exec(lower)); ) nameHits.push({ text: n, start: m.index, end: m.index + n.length });
  }
  if (nameHits.length === 0) return [];

  // Colourway hits, longest-first, non-overlapping (so "navy stripe" wins over "navy").
  const colourHits: Span[] = [];
  const used = new Array(lower.length).fill(false);
  for (const c of idx.colourways) {
    const re = new RegExp('(?<![a-z])' + escapeRe(c) + '(?![a-z])', 'g');
    for (let m; (m = re.exec(lower)); ) {
      const start = m.index, end = start + c.length;
      let clash = false;
      for (let i = start; i < end; i++) if (used[i]) { clash = true; break; }
      if (clash) continue;
      for (let i = start; i < end; i++) used[i] = true;
      colourHits.push({ text: c, start, end });
    }
  }

  const out = new Map<string, CaptionViolation>();
  for (const ch of colourHits) {
    // Bind the colourway to the product it grammatically belongs to: the nearest
    // PRECEDING product name on the same line. Captions read "Product in Colourway"
    // / "Product Colourway", so the colourway attaches to the product just before
    // it — never to a following product, and never to a more distant one when a
    // closer product sits between them. This kills proximity bleed: in "Nicola in
    // Vintage Navy with the Claire skirt" the colourway binds to Nicola only, not
    // the nearby Claire; in "Claire in Navy with the Hannah … in White" navy binds
    // to Claire and white to Hannah, not crossed.
    let best: Span | null = null;
    for (const nh of nameHits) {
      if (nh.end > ch.start) continue;                          // must precede the colourway
      if (ch.start - nh.end > windowChars) continue;            // within the window
      if (text.slice(nh.end, ch.start).includes('\n')) continue; // same line/paragraph
      if (!best || nh.end > best.end) best = nh;                // keep the closest preceding
    }
    if (!best) continue;
    const valid = idx.colourwaysByName.get(best.text);
    if (valid && !valid.has(ch.text)) {
      const key = `${best.text}|${ch.text}`;
      if (!out.has(key)) out.set(key, { name: best.text, colourway: ch.text, valid: [...valid] });
    }
  }
  return [...out.values()];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * SOFT grounding — the real-products list for the generation prompt.
 * Ranks families by relevance: named in the intake (highest), then being pushed
 * (pre-order / back-soon), then by sales — so the most relevant survive if a huge
 * catalogue exceeds the cap. The cap is generous (60) so a normal client's whole
 * catalogue is grounded: every product the model might style as a supporting piece
 * has its real colourways, removing the "must invent because it was cut" pressure
 * (the cap costs ~4 tokens/family — trivial vs the generation call).
 *
 * Each line binds colourways to ONE product with "available ONLY in:" so the model
 * cannot read the colourways as a shared palette and cross-apply one product's
 * colourway to another (the "Nicola in dark olive" failure). The omit-rule and
 * anti-bleed instruction that pair with this block live in the generation prompt.
 */
export function buildCatalogueGroundingBlock(cat: Catalogue, intakeText: string, maxFamilies = 60): string {
  const families = cat.families ?? [];
  if (families.length === 0) return '';
  const text = intakeText.toLowerCase();
  const named = (f: ProductFamily) =>
    new RegExp('\\b' + escapeRe(f.name.toLowerCase()) + '\\b').test(text);
  const pushed = (f: ProductFamily) => f.variants.some((v) => v.status === 'pre-order' || v.status === 'back-soon');
  const sales = (f: ProductFamily) => f.variants.reduce((n, v) => n + (v.sales?.netItemsSold ?? 0), 0);
  const score = (f: ProductFamily) => (named(f) ? 1000 : 0) + (pushed(f) ? 500 : 0) + sales(f) / 1000;

  const ranked = [...families].sort((a, b) => score(b) - score(a)).slice(0, maxFamilies);
  return ranked.map((f) => {
    const cols = f.variants.map((v) => v.colourway + (v.status !== 'live' ? ` [${v.status.toUpperCase()}]` : '')).join(', ');
    return `- ${f.name} (${f.style}) — available ONLY in: ${cols}`;
  }).join('\n');
}

export interface ValidatedCaption { caption: string; notes: string[]; violations: CaptionViolation[]; }

/** Rewrite invalid colourways in a caption to "[confirm colourway]" + return notes. */
export function applyCatalogueValidation(caption: string, notes: string, idx: CatalogueIndex): ValidatedCaption {
  const violations = validateText(caption, idx);
  if (violations.length === 0) return { caption, notes: notes ? [notes] : [], violations: [] };

  let out = caption;
  const newNotes: string[] = [];
  for (const v of violations) {
    const re = new RegExp('(?<![a-zA-Z])' + escapeRe(v.colourway) + '(?![a-zA-Z])', 'gi');
    out = out.replace(re, '[confirm colourway]');
    newNotes.push(`${cap(v.name)} is not available in "${v.colourway}" — real colourways: ${v.valid.join(', ')}. Confirm the colourway before posting.`);
  }
  return { caption: out, notes: [...(notes ? [notes] : []), ...newNotes], violations };
}
