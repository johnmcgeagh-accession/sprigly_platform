/**
 * catalogue-refresh-cli.ts — parse a sales export and upsert the cached catalogue
 * for a client/channel (latest-wins). Run monthly from each new sales export.
 *
 * Usage: pnpm catalogue-refresh <client-slug> <channel> <YYYY-MM> <sales.csv>
 */
import { readFileSync } from 'node:fs';
import { eq, and } from 'drizzle-orm';
import { db, clients, clientProductCatalogue } from '@sprigly/db';
import { buildCatalogue, type SalesRow } from './parse-catalogue.js';

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  for (const ln of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (ln.trim() === '') continue;
    const f: string[] = []; let i = 0;
    while (i <= ln.length) {
      if (ln[i] === '"') {
        i++; let s = '';
        while (i < ln.length) { if (ln[i] === '"' && ln[i + 1] === '"') { s += '"'; i += 2; } else if (ln[i] === '"') { i++; break; } else s += ln[i++]; }
        f.push(s); if (ln[i] === ',') i++;
      } else { const e = ln.indexOf(',', i); if (e === -1) { f.push(ln.slice(i)); break; } f.push(ln.slice(i, e)); i = e + 1; }
    }
    out.push(f);
  }
  return out;
}

const [, , slug, channel, month, salesPath] = process.argv;
if (!slug || !channel || !month || !salesPath) {
  console.error('Usage: pnpm catalogue-refresh <client-slug> <channel> <YYYY-MM> <sales.csv>');
  process.exit(1);
}

const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
if (!client) { console.error(`No client with slug "${slug}"`); process.exit(1); }

const rows = parseCsv(readFileSync(salesPath, 'utf-8'));
const header = rows[0]!.map((h) => h.trim());
const col = (n: string) => header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
const iT = col('Product title'), iI = col('Net items sold'), iN = col('Net sales'), iR = col('Returns');
const salesRows: SalesRow[] = rows.slice(1)
  .filter((r) => (r[iT] ?? '').trim() !== '')
  .map((r) => ({ title: r[iT] ?? '', netItemsSold: r[iI] ?? '', netSales: r[iN] ?? '', returns: r[iR] ?? '' }));

const cat = buildCatalogue(salesRows);
const variants = cat.families.reduce((n, f) => n + f.variants.length, 0);

await db.insert(clientProductCatalogue)
  .values({ clientId: client.id, channel, sourceMonth: month, catalogue: cat as unknown as Record<string, unknown>, refreshedAt: new Date() })
  .onConflictDoUpdate({
    target: [clientProductCatalogue.clientId, clientProductCatalogue.channel],
    set: { sourceMonth: month, catalogue: cat as unknown as Record<string, unknown>, refreshedAt: new Date(), updatedAt: new Date() },
  });

console.log(`catalogue refreshed for ${slug}/${channel} (${month}): ${cat.families.length} families, ${variants} variants, ${cat.flagged.length} excluded`);
process.exit(0);
