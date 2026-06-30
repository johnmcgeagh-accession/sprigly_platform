/**
 * catalogue-review-cli.ts — STAGE 1 review: parse a sales export and emit a
 * human-readable catalogue review (markdown) for approval BEFORE any caching or
 * planner wiring.
 *
 * Usage: tsx catalogue-review-cli.ts <sales.csv> <out.md>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCatalogue, type SalesRow, type ProductStatus } from './parse-catalogue.js';

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas).
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  const input = text.replace(/^﻿/, '');
  for (const rawLine of input.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const fields: string[] = [];
    let i = 0;
    while (i <= rawLine.length) {
      if (rawLine[i] === '"') {
        i++; let f = '';
        while (i < rawLine.length) {
          if (rawLine[i] === '"' && rawLine[i + 1] === '"') { f += '"'; i += 2; }
          else if (rawLine[i] === '"') { i++; break; }
          else f += rawLine[i++];
        }
        fields.push(f);
        if (rawLine[i] === ',') i++;
      } else {
        const end = rawLine.indexOf(',', i);
        if (end === -1) { fields.push(rawLine.slice(i)); break; }
        fields.push(rawLine.slice(i, end)); i = end + 1;
      }
    }
    out.push(fields);
  }
  return out;
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('Usage: tsx catalogue-review-cli.ts <sales.csv> <out.md>'); process.exit(1); }

const rows = parseCsv(readFileSync(inPath, 'utf-8'));
const header = rows[0]!.map((h) => h.trim());
const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
const iTitle = col('Product title'), iItems = col('Net items sold'), iNet = col('Net sales'), iRet = col('Returns');

const salesRows: SalesRow[] = rows.slice(1)
  .filter((r) => (r[iTitle] ?? '').trim() !== '')
  .map((r) => ({ title: r[iTitle] ?? '', netItemsSold: r[iItems] ?? '', netSales: r[iNet] ?? '', returns: r[iRet] ?? '' }));

const cat = buildCatalogue(salesRows);
const variants = cat.families.reduce((n, f) => n + f.variants.length, 0);
const kidsFamilies = cat.families.filter((f) => f.kids).length;
const STATUS_LABEL: Record<ProductStatus, string> = { live: 'live', 'pre-order': 'PRE-ORDER', 'back-soon': 'BACK SOON', 'sample-sale': 'SAMPLE SALE' };
const badge = (p: { status: ProductStatus; statusDetail?: string }) =>
  p.status === 'live' ? '' : `**${STATUS_LABEL[p.status]}${p.statusDetail ? ` (${p.statusDetail})` : ''}**`;

const md: string[] = [];
md.push(`# IVY-t product catalogue — parse review`);
md.push(`Source: \`${inPath}\` · ${salesRows.length} sales rows\n`);
md.push(`## Summary`);
md.push(`- **Families:** ${cat.families.length} (${kidsFamilies} kids)`);
md.push(`- **Conforming variants:** ${variants}`);
md.push(`- **Flagged non-conforming:** ${cat.flagged.length}`);
md.push(`- **Status:** live ${cat.statusBreakdown.live} · PRE-ORDER ${cat.statusBreakdown['pre-order']} · BACK SOON ${cat.statusBreakdown['back-soon']} · SAMPLE SALE ${cat.statusBreakdown['sample-sale']}\n`);

md.push(`## Families (parsed: original title → name | style | colourway | status)\n`);
for (const f of cat.families) {
  md.push(`### ${f.family}  _(${f.variants.length} colourway${f.variants.length === 1 ? '' : 's'}${f.kids ? ', kids' : ''})_`);
  md.push(`| Colourway | Status | Net items | Net sales | Returns | (original title) |`);
  md.push(`|---|---|--:|--:|--:|---|`);
  for (const v of f.variants) {
    md.push(`| ${v.colourway} | ${badge(v) || '—'} | ${v.sales.netItemsSold} | ${v.sales.netSales} | ${v.sales.returns} | \`${v.originalTitle}\` |`);
  }
  md.push('');
}

const special = cat.families.flatMap((f) => f.variants).filter((v) => v.salvaged || v.finish);
md.push(`## Salvaged / finish-noted variants (INCLUDED — previously flagged)\n`);
md.push(`| Original title | Family | Colourway | Note |`);
md.push(`|---|---|---|---|`);
for (const v of special) md.push(`| \`${v.originalTitle}\` | ${v.name} ${v.style} | ${v.colourway} | ${v.salvaged ? 'salvaged (missing "Organic Cotton")' : ''}${v.finish ? ` finish: ${v.finish}` : ''} |`);
md.push('');

md.push(`## ⚠️ Excluded — non-garments (kept OUT of the catalogue)\n`);
md.push(`| Original title | Reason |`);
md.push(`|---|---|`);
for (const p of cat.flagged) md.push(`| \`${p.originalTitle}\` | ${p.flagReason} |`);

writeFileSync(outPath, md.join('\n') + '\n');
console.log(`families=${cat.families.length} variants=${variants} flagged=${cat.flagged.length} kidsFamilies=${kidsFamilies}`);
console.log(`status: live=${cat.statusBreakdown.live} pre-order=${cat.statusBreakdown['pre-order']} back-soon=${cat.statusBreakdown['back-soon']} sample-sale=${cat.statusBreakdown['sample-sale']}`);
console.log(`review written → ${outPath}`);
