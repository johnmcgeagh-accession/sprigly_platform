import 'server-only';
import { db, clientProductCatalogue } from '@sprigly/db';
import { buildCatalogue, type SalesRow } from '@sprigly/engine';
import { getChannelDrive, upsertDriveFile } from './drive';

/**
 * ingestSales — the shared sales input core. Validates the four catalogue headers,
 * writes sales-<month>.csv to the channel Drive folder (so lean-line sees it), AND
 * rebuilds client_product_catalogue (so PLANNING sees it — a Drive drop alone is a
 * trap). Filesystem-free: takes the CSV in memory, so the future client-facing upload
 * and a Shopify pull can call this same function with a Buffer.
 */

export const REQUIRED_SALES_HEADERS = ['Product title', 'Net items sold', 'Net sales', 'Returns'] as const;

/** Quote-aware CSV parser (ported verbatim from catalogue-refresh-cli.ts, minus the fs read). */
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

export interface IngestSalesResult { ok: boolean; message: string; products?: number }

export async function ingestSales(clientId: string, channel: string, month: string, csv: Buffer): Promise<IngestSalesResult> {
  const rows = parseCsv(csv.toString('utf-8'));
  const header = rows[0];
  if (!header || rows.length < 2) return { ok: false, message: 'CSV has no data rows.' };

  const trimmed = header.map((h) => h.trim());
  const col = (n: string) => trimmed.findIndex((h) => h.toLowerCase() === n.toLowerCase());
  const missing = REQUIRED_SALES_HEADERS.filter((h) => col(h) === -1);
  if (missing.length) {
    return { ok: false, message: `Missing required column(s): ${missing.join(', ')}. Expected a Shopify "Sales by product" export with headers: ${REQUIRED_SALES_HEADERS.join(', ')}.` };
  }

  const iT = col('Product title'), iI = col('Net items sold'), iN = col('Net sales'), iR = col('Returns');
  const salesRows: SalesRow[] = rows.slice(1)
    .filter((r) => (r[iT] ?? '').trim() !== '')
    .map((r) => ({ title: r[iT] ?? '', netItemsSold: r[iI] ?? '', netSales: r[iN] ?? '', returns: r[iR] ?? '' }));
  if (salesRows.length === 0) return { ok: false, message: 'No product rows found under "Product title".' };

  // 1. Write to Drive (lean-line reads sales-<month>.csv live).
  const d = await getChannelDrive(clientId, channel);
  if ('error' in d) return { ok: false, message: d.error };
  await upsertDriveFile(d.drive, d.driveFolderId, `sales-${month}.csv`, 'text/csv', csv);

  // 2. Rebuild the catalogue (planning reads client_product_catalogue, NOT the CSV).
  const cat = buildCatalogue(salesRows);
  const products = cat.families.reduce((n, f) => n + f.variants.length, 0);
  await db.insert(clientProductCatalogue)
    .values({ clientId, channel, sourceMonth: month, catalogue: cat as unknown as Record<string, unknown>, refreshedAt: new Date() })
    .onConflictDoUpdate({
      target: [clientProductCatalogue.clientId, clientProductCatalogue.channel],
      set: { sourceMonth: month, catalogue: cat as unknown as Record<string, unknown>, refreshedAt: new Date(), updatedAt: new Date() },
    });

  return {
    ok: true,
    products,
    message: `Sales uploaded and catalogue rebuilt: ${products} products across ${cat.families.length} families (${cat.flagged.length} rows flagged as non-conforming).`,
  };
}
