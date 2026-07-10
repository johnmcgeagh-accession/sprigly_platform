import { describe, it, expect } from 'vitest';
import { indexCatalogue, validateText, applyCatalogueValidation, buildCatalogueGroundingBlock, deriveBrandTokens } from './validate-catalogue.js';
import type { Catalogue, ProductFamily } from './parse-catalogue.js';

const fam = (name: string, style: string, colourways: string[]): ProductFamily => ({
  family: `${name} ${style}`, name, style, kids: false,
  variants: colourways.map((c) => ({
    originalTitle: '', conforming: true, name, style, fabric: 'organic cotton',
    colourway: c, status: 'live', kids: false, sales: { netItemsSold: 1, netSales: 1, returns: 0 },
  })),
});

const cat: Catalogue = {
  families: [
    fam('Elle', 'Semi-Fitted Dress', ['Black', 'Navy', 'Navy Stripe']),
    fam('Emma', 'T-Shirt Dress', ['Black', 'Dark Olive', 'Navy']),
    fam('Ivy', 'Crew T-Shirt', ['Ecru']),        // brand-collision name — must be ignored
  ],
  flagged: [],
  statusBreakdown: { live: 7, 'pre-order': 0, 'back-soon': 0, 'sample-sale': 0 },
};
const idx = indexCatalogue(cat, undefined, deriveBrandTokens('IVY-t'));

describe('deriveBrandTokens — per-client brand-word exclusion (generalises the old {ivy})', () => {
  it('IVY-t → {ivy} (the 1-char "t" dropped) — preserves the hardcoded behaviour', () => {
    expect([...deriveBrandTokens('IVY-t')].sort()).toEqual(['ivy']);
  });
  it('Earl of East → {earl, east} ("of" dropped by the length floor)', () => {
    expect([...deriveBrandTokens('Earl of East')].sort()).toEqual(['earl', 'east']);
  });
  it('drops generic stopwords (The Linen Room → {linen, room})', () => {
    expect([...deriveBrandTokens('The Linen Room')].sort()).toEqual(['linen', 'room']);
  });
  it('a name with no qualifying token → empty set (nothing excluded)', () => {
    expect(deriveBrandTokens('AB Co').size).toBe(0);
  });
  it('the "Ivy" family is EXCLUDED from product matching under IVY-t tokens, but INCLUDED for a brand whose tokens do not contain it', () => {
    // Under IVY-t (brand token 'ivy'), 'ivy' is not a matchable product name, so brand
    // mentions never false-flag.
    expect(indexCatalogue(cat, undefined, deriveBrandTokens('IVY-t')).names).not.toContain('ivy');
    expect(validateText('Every Ivy piece in navy is built to last.', indexCatalogue(cat, undefined, deriveBrandTokens('IVY-t')))).toEqual([]);
    // For a different brand (tokens {some, other, brand}), 'Ivy' is a real product name.
    expect(indexCatalogue(cat, undefined, deriveBrandTokens('Some Other Brand')).names).toContain('ivy');
  });
});

describe('catalogue HARD validation', () => {
  it('flags a real colourway applied to the WRONG product (the core failure)', () => {
    const v = validateText('This week, Elle in dark olive is the one.', idx);
    expect(v).toEqual([{ name: 'elle', colourway: 'dark olive', valid: ['black', 'navy', 'navy stripe'] }]);
  });

  it('passes a valid product+colourway (Emma in dark olive — a real variant)', () => {
    expect(validateText('Emma in dark olive has landed.', idx)).toEqual([]);
  });

  it('passes a valid Elle colourway', () => {
    expect(validateText('Elle in navy, back where she belongs.', idx)).toEqual([]);
  });

  it('does not flag generic colour usage with no nearby product', () => {
    expect(validateText('The navy that goes with everything, every day.', idx)).toEqual([]);
  });

  it('does not associate a product and colour across a line break', () => {
    expect(validateText('Meet Elle.\nWe also love dark olive this season.', idx)).toEqual([]);
  });

  it('ignores the brand-collision name "Ivy"', () => {
    // "Ivy" is excluded from product matching, so brand mentions never false-flag.
    expect(validateText('Every Ivy piece in navy is built to last.', idx)).toEqual([]);
  });

  it('rewrites the invalid colourway to a placeholder and adds a note', () => {
    const r = applyCatalogueValidation('Loving Elle in dark olive.', 'Shoot flat.', idx);
    expect(r.caption).toBe('Loving Elle in [confirm colourway].');
    expect(r.notes[0]).toBe('Shoot flat.');
    expect(r.notes[1]).toMatch(/Elle is not available in "dark olive"/);
  });
});

describe('buildCatalogueGroundingBlock — SOFT grounding (per-product binding)', () => {
  it('binds colourways to each product with an explicit "available ONLY in" line', () => {
    const block = buildCatalogueGroundingBlock(cat, '');
    expect(block).toContain('- Elle (Semi-Fitted Dress) — available ONLY in: Black, Navy, Navy Stripe');
    expect(block).toContain('- Emma (T-Shirt Dress) — available ONLY in: Black, Dark Olive, Navy');
    // "Dark Olive" appears ONLY on Emma's line, never on Elle's — no shared pool.
    const elleLine = block.split('\n').find((l) => l.startsWith('- Elle'))!;
    expect(elleLine).not.toMatch(/dark olive/i);
  });

  it('marks non-live status (pre-order / back-soon) inline', () => {
    const c2: Catalogue = { ...cat, families: [
      { ...fam('Nicola', 'T-Shirt', ['Vintage Navy / Ecru Raglan']),
        variants: [{ originalTitle: '', conforming: true, name: 'Nicola', style: 'T-Shirt', fabric: 'organic cotton',
          colourway: 'Vintage Navy / Ecru Raglan', status: 'pre-order', kids: false, sales: { netItemsSold: 0, netSales: 0, returns: 0 } }] },
    ] };
    expect(buildCatalogueGroundingBlock(c2, '')).toContain('- Nicola (T-Shirt) — available ONLY in: Vintage Navy / Ecru Raglan [PRE-ORDER]');
  });

  it('grounds the whole catalogue under the generous default cap (no silent cut for normal clients)', () => {
    expect(buildCatalogueGroundingBlock(cat, '').split('\n').length).toBe(cat.families.length);
  });

  it('returns empty string when there is no catalogue', () => {
    expect(buildCatalogueGroundingBlock({ ...cat, families: [] }, '')).toBe('');
  });
});

describe('validateText — precision (compound colourways + grammatical binding)', () => {
  // Mirrors the IVY-t shapes that produced the false positives.
  const cat2: Catalogue = {
    families: [
      fam('Nicola', 'T-Shirt', ['Vintage Navy / Ecru Raglan']),  // compound colourway
      fam('Claire', 'Skirt', ['Black', 'Dark Olive', 'Navy', 'Plum']),
      fam('Hannah', 'T-Shirt', ['White', 'Cornflower', 'Ecru', 'Navy Breton']),  // no plain navy
      fam('Mabel', 'T-Shirt', ['Navy', 'Grey Marl']),
      fam('Joy', 'Shorts', ['Vintage Navy', 'Watermelon']),
    ],
    flagged: [], statusBreakdown: { live: 13, 'pre-order': 0, 'back-soon': 0, 'sample-sale': 0 },
  };
  const idx2 = indexCatalogue(cat2, undefined, deriveBrandTokens('IVY-t'));

  // ── compound colourways: a component reference is valid ──
  it('accepts a component of a compound colourway (Nicola in Vintage Navy / Ecru Raglan)', () => {
    expect(validateText('Nicola in Vintage Navy is the one I reach for.', idx2)).toEqual([]);
    expect(validateText('Nicola in Ecru Raglan, tucked in at the front.', idx2)).toEqual([]);
  });

  // ── proximity / grammatical binding: colourway binds to its product only ──
  it('does not bleed a colourway onto a nearby supporting product', () => {
    // "Vintage Navy" belongs to Nicola; Claire (no colourway) must NOT be flagged.
    expect(validateText('Nicola in Vintage Navy, tucked into the Claire skirt.', idx2)).toEqual([]);
  });

  it('binds each colourway to its own product across a multi-product line', () => {
    // Claire in Navy (valid) + Hannah in White (valid) — no crossed "hannah in navy".
    expect(validateText('Claire in Navy with the Hannah T-Shirt in White.', idx2)).toEqual([]);
  });

  it('does not bind a colourway to a FOLLOWING product (trainers/shorts nouns)', () => {
    expect(validateText('Nicola in Ecru Raglan, with Joy shorts and sandals.', idx2)).toEqual([]);
  });

  // ── genuine fabrications are STILL caught (precision, not leniency) ──
  it('still flags a genuinely wrong product+colourway pairing', () => {
    expect(validateText('Claire in Cornflower this week.', idx2))
      .toEqual([{ name: 'claire', colourway: 'cornflower', valid: ['black', 'dark olive', 'navy', 'plum'] }]);
  });

  it('still flags a hero-colourway bled onto the wrong product when grammatically bound', () => {
    expect(validateText('Mabel in Ecru is back.', idx2)[0]?.name).toBe('mabel');
  });
});
