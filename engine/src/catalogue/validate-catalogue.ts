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
import type { StructuredBrief } from '@sprigly/engine';

export interface CatalogueIndex {
  /** product name (lower) → set of its valid colourways (lower) across all families */
  colourwaysByName: Map<string, Set<string>>;
  names:      string[];   // product names to match (ambiguous/brand names excluded)
  colourways: string[];   // distinct colourway phrases, longest-first (catalogue-only)
  /** product name (lower) → colourways admitted ONLY because the brief declared them
   *  (i.e. not a sold variant of that product). Provenance tag for briefed launches
   *  (e.g. Connie → {violet}); empty when no brief is merged. */
  briefedByName: Map<string, Set<string>>;
}

// Generic connectors dropped from brand tokens so a name like "Earl of East" doesn't
// exclude "of", and "The Linen Room" doesn't turn "the" into a brand token.
const BRAND_STOPWORDS = new Set(['the', 'and', 'for', 'our']);

/**
 * The client's own brand-name tokens that must NEVER be matched as product names — the
 * brand word colliding with a garment/product (previously the hardcoded {'ivy'}). Derived
 * per-client from clients.name: lowercase, split on non-alphanumeric, keep tokens of length
 * ≥ 3 that aren't a generic stopword. Examples (exact, current behaviour preserved):
 *   "IVY-t"        → {ivy}          (the 1-char "t" is dropped by the length floor)
 *   "Earl of East" → {earl, east}   ("of" dropped by the length floor)
 * Returns an empty set when the name yields no qualifying token (then nothing is excluded).
 */
export function deriveBrandTokens(brandName: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (brandName ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !BRAND_STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** The catalogue family name a briefed product refers to: the longest catalogue
 *  name that appears as a whole word in the brief's product string ("Connie
 *  sweatshirt" → "connie"). null when the brief names a product not in the
 *  catalogue. */
function matchBriefToCatalogueName(briefProduct: string, catalogueNames: string[], ambiguousNames: Set<string>): string | null {
  const b = briefProduct.toLowerCase().trim();
  let best: string | null = null;
  for (const n of catalogueNames) {
    if (ambiguousNames.has(n)) continue;
    if (new RegExp('\\b' + escapeRe(n) + '\\b').test(b) && (best === null || n.length > best.length)) best = n;
  }
  return best;
}

export function indexCatalogue(cat: Catalogue, brief: StructuredBrief | null | undefined, ambiguousNames: Set<string>): CatalogueIndex {
  const colourwaysByName = new Map<string, Set<string>>();
  const colourSet = new Set<string>();
  for (const fam of cat.families) {
    const name = fam.name.toLowerCase().trim();
    if (ambiguousNames.has(name)) continue;
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

  // ── Merge the structured brief's (product → colourway) pairs ─────────────────
  // A briefed launch colourway (e.g. Connie Violet) has no sales line, so it is
  // absent from the catalogue and would be flagged as a fabrication. Admit it into
  // the SPECIFIC product's valid set only — NOT the global colourway vocabulary
  // (colourSet), so "Violet" stays a real Hannah colourway and Connie-Violet vs
  // Hannah-Violet remain distinguishable. briefedByName records the ones admitted
  // solely because of the brief (not already a sold variant).
  const briefedByName = new Map<string, Set<string>>();
  const catalogueNames = [...colourwaysByName.keys()];
  for (const p of brief?.products ?? []) {
    const colour = (p.colourway ?? '').toLowerCase().trim();
    if (!colour) continue;
    const name = matchBriefToCatalogueName(p.product, catalogueNames, ambiguousNames) ?? p.product.toLowerCase().trim();
    if (!name || ambiguousNames.has(name)) continue;
    let set = colourwaysByName.get(name);
    if (!set) { set = new Set(); colourwaysByName.set(name, set); }
    const newlyBriefed = !set.has(colour);   // not already a sold/known variant
    set.add(colour);
    if (colour.includes('/')) for (const part of colour.split('/')) { const q = part.trim(); if (q) set.add(q); }
    if (newlyBriefed) {
      let brf = briefedByName.get(name);
      if (!brf) { brf = new Set(); briefedByName.set(name, brf); }
      brf.add(colour);
    }
  }

  return {
    colourwaysByName,
    names: [...colourwaysByName.keys()],
    colourways: [...colourSet].sort((a, b) => b.length - a.length), // longest-first
    briefedByName,
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
export function buildCatalogueGroundingBlock(
  cat: Catalogue,
  intakeText: string,
  brief?: StructuredBrief | null,
  maxFamilies = 60,
): string {
  const families = cat.families ?? [];
  if (families.length === 0) return '';
  const text = intakeText.toLowerCase();
  const named = (f: ProductFamily) =>
    new RegExp('\\b' + escapeRe(f.name.toLowerCase()) + '\\b').test(text);
  const pushed = (f: ProductFamily) => f.variants.some((v) => v.status === 'pre-order' || v.status === 'back-soon');
  const sales = (f: ProductFamily) => f.variants.reduce((n, v) => n + (v.sales?.netItemsSold ?? 0), 0);
  const score = (f: ProductFamily) => (named(f) ? 1000 : 0) + (pushed(f) ? 500 : 0) + sales(f) / 1000;

  // Briefed launch colourways for a family: (product → colourway) declared in the
  // brief that are NOT a sold variant of that family (e.g. Connie Violet). Rendered
  // with a distinct [BRIEFED LAUNCH] marker so the model sees the colourway exists
  // and is briefed, not sold. Original case preserved from the brief.
  const briefedLaunches = (f: ProductFamily): string[] => {
    const sold = new Set(f.variants.map((v) => (v.colourway ?? '').toLowerCase().trim()));
    const nameRe = new RegExp('\\b' + escapeRe(f.name.toLowerCase()) + '\\b');
    const out: string[] = [];
    for (const p of brief?.products ?? []) {
      const colour = (p.colourway ?? '').trim();
      if (!colour) continue;
      if (!nameRe.test(p.product.toLowerCase())) continue;         // brief product is this family
      if (sold.has(colour.toLowerCase())) continue;                // already a sold line
      if (out.some((c) => c.toLowerCase() === colour.toLowerCase())) continue; // dedupe
      out.push(colour);
    }
    return out;
  };

  const ranked = [...families].sort((a, b) => score(b) - score(a)).slice(0, maxFamilies);
  return ranked.map((f) => {
    const cols = f.variants.map((v) => v.colourway + (v.status !== 'live' ? ` [${v.status.toUpperCase()}]` : '')).join(', ');
    const briefed = briefedLaunches(f).map((c) => `${c} [BRIEFED LAUNCH]`);
    const allCols = briefed.length ? [cols, ...briefed].filter(Boolean).join(', ') : cols;
    return `- ${f.name} (${f.style}) — available ONLY in: ${allCols}`;
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
