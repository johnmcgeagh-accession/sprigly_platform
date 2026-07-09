/**
 * agent/catalogue.ts — app-side product-catalogue index for the task parser.
 *
 * The catalogue is a single JSONB blob per (client, channel) in
 * client_product_catalogue. The parser needs a COMPACT name/style/colourway index
 * to ground a named product ("a reel about the maebelle") — no sales data, no
 * status tags, no relevance ranking. This is deliberately NOT engine's
 * buildCatalogueGroundingBlock (that needs an intakeText and would force an
 * @sprigly/engine dependency on app).
 *
 * This runs on EVERY client message, so it must never throw: the blob is cast to a
 * minimal local shape and every field is read defensively (optional chaining, ?? []
 * on variants). A missing or renamed field degrades to a thinner line — never an
 * exception that would stall the parser.
 */
import { and, eq } from 'drizzle-orm';
import { db, clientProductCatalogue } from '@sprigly/db';

/** Minimal local shape — only the fields the index formatter reads. Intentionally
 *  independent of engine's Catalogue type so app carries no engine dependency. */
interface CatalogueBlob {
  families?: { name?: string; style?: string; variants?: { colourway?: string }[] }[];
}

const NO_CATALOGUE = '(no product catalogue available)';
const MAX_FAMILIES = 80;

/**
 * Load the client's product catalogue and format it as one compact line per family:
 *   - Anna (Button Through Vest) — Ecru, Navy, Sage
 * Returns '(no product catalogue available)' when there is no catalogue row (or it's
 * empty/unreadable). Never throws.
 */
export async function loadProductIndex(clientId: string, channel: string): Promise<string> {
  let blob: CatalogueBlob | undefined;
  try {
    const [row] = await db
      .select({ catalogue: clientProductCatalogue.catalogue })
      .from(clientProductCatalogue)
      .where(and(
        eq(clientProductCatalogue.clientId, clientId),
        eq(clientProductCatalogue.channel, channel),
      ))
      .limit(1);
    blob = row?.catalogue as CatalogueBlob | undefined;
  } catch {
    // A catalogue read hiccup must not break the parser — degrade to "no catalogue".
    return NO_CATALOGUE;
  }

  const families = blob?.families;
  if (!Array.isArray(families) || families.length === 0) return NO_CATALOGUE;

  const lines = families.slice(0, MAX_FAMILIES)
    .map((f) => {
      const name = typeof f?.name === 'string' ? f.name.trim() : '';
      if (!name) return null;
      const style = typeof f?.style === 'string' && f.style.trim() ? ` (${f.style.trim()})` : '';
      const colours = (f?.variants ?? [])
        .map((v) => (typeof v?.colourway === 'string' ? v.colourway.trim() : ''))
        .filter(Boolean);
      const cols = colours.length ? ` — ${colours.join(', ')}` : '';
      return `- ${name}${style}${cols}`;
    })
    .filter((l): l is string => l !== null);

  return lines.length ? lines.join('\n') : NO_CATALOGUE;
}
