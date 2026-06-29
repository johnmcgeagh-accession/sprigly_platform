import { describe, it, expect } from 'vitest';
import { indexCatalogue, validateText, applyCatalogueValidation } from './validate-catalogue.js';
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
const idx = indexCatalogue(cat);

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
