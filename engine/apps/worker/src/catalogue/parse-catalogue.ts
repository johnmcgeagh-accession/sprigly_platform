/**
 * parse-catalogue.ts — parse the monthly sales export's "Product title" column
 * into a structured product catalogue (families → colourway variants).
 *
 * STAGE 1: pure parser + family grouping. No DB, no planner wiring. The catalogue
 * is the authoritative list the planner will SELECT from and be VALIDATED against,
 * so an invented product (e.g. "Elle in dark olive" when Elle only exists in
 * Black/Navy/Navy Stripe) can be caught: family must exist, and a named colourway
 * must be a real variant of that family.
 *
 * Title grammar (anchored on "Organic Cotton"):
 *   [Kids] <Name> [<style-modifier>] Organic Cotton <Colourway> <style-word> [<STATUS>]
 *   - style-modifier (cut/fit/weight, belongs with STYLE not name): Luxe Rib, Low
 *     Crew, Authentic Oversized, Midweight, Long Sleeve Midweight, Button Through, …
 *   - style-word (garment type): T-Shirt, Vest, Dress, Skirt, Sweatshirt, …
 *   - colourway: kept whole, never split on "/" (e.g. "Ocean / Teal Breton").
 *   - STATUS suffix stripped into its own field: BACK SOON / PRE-ORDER / SAMPLE SALE.
 * Non-conforming rows (gift voucher, scrunchie, missing "Organic Cotton", finish
 * qualifier) are FLAGGED, never force-parsed.
 */

export interface VariantSales { netItemsSold: number; netSales: number; returns: number; }
export type ProductStatus = 'live' | 'pre-order' | 'back-soon' | 'sample-sale';

export interface ParsedProduct {
  originalTitle: string;
  conforming:    boolean;
  flagReason?:   string;       // set when conforming === false
  name?:         string;
  style?:        string;       // modifier(s) + style-word, e.g. "Low Crew T-Shirt"
  fabric?:       string;       // "organic cotton" for conforming rows
  colourway?:    string;
  status:        ProductStatus;
  statusDetail?: string;       // e.g. "8/12" for sample sale
  finish?:       string;       // e.g. "Brush Back Finish" — stripped from the title
  salvaged?:     boolean;      // parsed despite a malformed title (missing "Organic Cotton")
  excluded?:     boolean;      // non-garment (gift voucher, scrunchie) — kept OUT of the catalogue
  kids:          boolean;
  sales:         VariantSales;
}

export interface ProductFamily {
  family:   string;            // "<name> <style>" (+ "Kids " prefix when kids)
  name:     string;
  style:    string;
  kids:     boolean;
  variants: ParsedProduct[];   // one per colourway
}

export interface Catalogue {
  families:       ProductFamily[];
  flagged:        ParsedProduct[];
  statusBreakdown: Record<ProductStatus, number>;
}

// Longest-first so multi-word phrases match before their substrings
// (e.g. "Luxe Rib" / "Low Crew" must be tried before bare "Luxe" / "Crew" / "Rib").
const STYLE_MODIFIERS = [
  'Long Sleeve Midweight', 'Authentic Oversized', 'Button Through', 'Funnel Neck',
  'Midweight Slub', 'Half Zip', 'Semi-Fitted', 'Luxe Rib', 'Low Crew', 'Oversized',
  'Midweight', 'Scoop', 'Crew', 'Luxe', 'Rib', '3/4', 'V',
];
const STYLE_WORDS = [
  'Sweatshirt Dress', 'T-Shirt Dress', 'Co-ord T-Shirt', 'Boyfriend T-Shirt', 'Midi Dress',
  'T-Shirt', 'Sweatshirt', 'Joggers', 'Henley', 'Shorts', 'Dress', 'Skirt', 'Vest', 'Top',
];

const STATUS_RE = /\s+(BACK SOON|PRE[\s-]?ORDER|SAMPLE SALE(?:\s*\((\d+\/\d+)\))?)\s*$/i;
const FINISH_RE = /\bBrush Back Finish\b/i;
const FABRIC    = 'Organic Cotton';

function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }
/** does `haystack` end with whole-word `phrase` (case-insensitive)? */
function endsWithPhrase(haystack: string, phrase: string): boolean {
  return new RegExp('(^|\\s)' + esc(phrase) + '$', 'i').test(haystack);
}
function num(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[£$,]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function parseProductTitle(title: string, sales: VariantSales): ParsedProduct {
  const originalTitle = title.trim();
  let s = originalTitle;
  const base = { originalTitle, kids: false, status: 'live' as ProductStatus, sales };

  // Kids prefix
  let kids = false;
  if (/^kids\s+/i.test(s)) { kids = true; s = s.replace(/^kids\s+/i, '').trim(); }

  // Status suffix
  let status: ProductStatus = 'live';
  let statusDetail: string | undefined;
  const sm = STATUS_RE.exec(s);
  if (sm) {
    const raw = sm[1]!.toUpperCase();
    if (raw.startsWith('BACK')) status = 'back-soon';
    else if (raw.startsWith('PRE')) status = 'pre-order';
    else { status = 'sample-sale'; statusDetail = sm[2]; }
    s = s.slice(0, sm.index).trim();
  }

  // Finish qualifier (e.g. "Brush Back Finish") → strip into its own field, keep parsing.
  let finish: string | undefined;
  const finm = FINISH_RE.exec(s);
  if (finm) { finish = finm[0].trim(); s = s.replace(FINISH_RE, '').trim(); }

  const fin = () => (finish !== undefined ? { finish } : {});
  const det = () => (statusDetail !== undefined ? { statusDetail } : {});
  const flag = (flagReason: string, excluded = false): ParsedProduct =>
    ({ ...base, kids, status, ...det(), ...fin(), conforming: false, ...(excluded ? { excluded: true } : {}), flagReason });

  const idx = s.search(/\bOrganic Cotton\b/i);

  // ── Standard path: "Organic Cotton" anchor present ────────────────────────────
  if (idx !== -1) {
    const before = s.slice(0, idx).trim();
    const after  = s.slice(idx + FABRIC.length).trim();

    let styleWord = ''; let colourway = after;
    for (const w of STYLE_WORDS) {
      if (endsWithPhrase(after, w)) { styleWord = w; colourway = after.slice(0, after.length - w.length).trim(); break; }
    }
    if (!styleWord) return flag('could not identify a garment style word after the colourway');
    if (!colourway) return flag('no colourway between "Organic Cotton" and the style word');

    let name = before; let modifier = '';
    for (const m of STYLE_MODIFIERS) {
      if (endsWithPhrase(before, m)) { modifier = m; name = before.slice(0, before.length - m.length).trim(); break; }
    }
    if (!name) return flag('empty product name after stripping style modifier');

    return {
      originalTitle, conforming: true, name, style: (modifier ? modifier + ' ' : '') + styleWord,
      fabric: 'organic cotton', colourway, status, ...det(), ...fin(), kids, sales,
    };
  }

  // ── No fabric anchor: SALVAGE a malformed garment, else EXCLUDE a non-garment ──
  const t = s.replace(/[\s\-–—]+$/, '').trim();   // drop trailing separators, e.g. "T-Shirt -"
  let sw = ''; let rest = t;
  for (const w of STYLE_WORDS) {
    if (endsWithPhrase(t, w)) { sw = w; rest = t.slice(0, t.length - w.length).trim(); break; }
  }
  if (!sw) return flag('non-garment — no fabric and no garment style word (excluded from catalogue)', true);
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return flag('malformed title — cannot split name/colourway without a fabric anchor', true);

  // First token = name, remainder = colourway (no anchor to separate them otherwise).
  return {
    originalTitle, conforming: true, salvaged: true, name: parts[0]!, style: sw,
    fabric: 'organic cotton', colourway: parts.slice(1).join(' '),
    status, ...det(), ...fin(), kids, sales, flagReason: 'salvaged — title was missing "Organic Cotton"',
  };
}

export interface SalesRow { title: string; netItemsSold: string; netSales: string; returns: string; }

/** Parse all rows, group conforming products into families, collect flagged rows. */
export function buildCatalogue(rows: SalesRow[]): Catalogue {
  const parsed = rows.map((r) => parseProductTitle(r.title, {
    netItemsSold: num(r.netItemsSold), netSales: num(r.netSales), returns: num(r.returns),
  }));

  const flagged = parsed.filter((p) => !p.conforming);
  const conforming = parsed.filter((p) => p.conforming);

  const famMap = new Map<string, ProductFamily>();
  for (const p of conforming) {
    const family = `${p.kids ? 'Kids ' : ''}${p.name} ${p.style}`;
    let fam = famMap.get(family);
    if (!fam) { fam = { family, name: p.name!, style: p.style!, kids: p.kids, variants: [] }; famMap.set(family, fam); }
    fam.variants.push(p);
  }
  const families = [...famMap.values()].sort((a, b) => a.family.localeCompare(b.family));
  for (const f of families) f.variants.sort((a, b) => (a.colourway ?? '').localeCompare(b.colourway ?? ''));

  const statusBreakdown: Record<ProductStatus, number> = { live: 0, 'pre-order': 0, 'back-soon': 0, 'sample-sale': 0 };
  for (const p of conforming) statusBreakdown[p.status]++;

  return { families, flagged, statusBreakdown };
}
