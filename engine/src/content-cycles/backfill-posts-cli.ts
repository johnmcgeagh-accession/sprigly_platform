/**
 * backfill-posts-cli.ts — one-off, MANUAL backfill of content_cycle_posts from an
 * already-generated plan CSV on Drive (the cycle's draft_csv_ref). Use this to
 * populate the structured rows for a cycle that was planned BEFORE the dual-write
 * existed (e.g. the current IVY-t cycle), so app/ can render it.
 *
 * Future planning runs populate content_cycle_posts directly via the dual-write in
 * planning.ts; this is only for catching up existing cycles.
 *
 * Usage: pnpm --filter @sprigly/worker backfill-posts <client-slug> <channel> [cycle-month]
 *   cycle-month (YYYY-MM, the cycle's DATA month) is optional — if omitted, the
 *   most recent cycle for that client/channel with a draft CSV is used.
 */
import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { db, clients, contentCycles, contentCyclePosts } from '@sprigly/db';
import type { NewContentCyclePostRow } from '@sprigly/db';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from '../env.js';
import { nextMonth } from './planning.js';
import { mapFormat, isoDateInMonth } from './post-mapping.js';

/** Quote-aware CSV parser that handles embedded newlines and "" escapes inside
 *  quoted fields — required because plan captions contain newlines within quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',')  { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const [, , slug, channel, monthArg] = process.argv;
if (!slug || !channel) {
  console.error('Usage: pnpm --filter @sprigly/worker backfill-posts <client-slug> <channel> [cycle-month]');
  process.exit(1);
}

const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
if (!client) { console.error(`No client with slug "${slug}"`); process.exit(1); }

const where = monthArg
  ? and(eq(contentCycles.clientId, client.id), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, monthArg))
  : and(eq(contentCycles.clientId, client.id), eq(contentCycles.channel, channel), isNotNull(contentCycles.draftCsvRef));
const [cycle] = await db.select().from(contentCycles).where(where).orderBy(desc(contentCycles.createdAt)).limit(1);
if (!cycle)             { console.error(`No matching cycle for ${slug}/${channel}${monthArg ? ` ${monthArg}` : ''}.`); process.exit(1); }
if (!cycle.draftCsvRef) { console.error(`Cycle ${cycle.id} (${cycle.cycleMonth}) has no draft_csv_ref — nothing to backfill.`); process.exit(1); }

const targetMonth = nextMonth(cycle.cycleMonth);
console.log(`Backfilling ${slug}/${channel} cycle ${cycle.id} — data ${cycle.cycleMonth} → plan ${targetMonth}`);

// ── Download + parse the plan CSV from Drive ──────────────────────────────────
const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, client.id, 'drive');
if (!tokens) { console.error(`No Drive tokens for client ${client.id}.`); process.exit(1); }
const drive = new DriveApiClient(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, tokens,
  (refreshed) => import('@sprigly/oauth-tokens').then((m) => m.storeTokens(db, encProvider, client.id, 'drive', refreshed)));

const csvText = (await drive.downloadFile(cycle.draftCsvRef)).toString('utf-8');
const grid = parseCsv(csvText);
if (grid.length < 2) { console.error('CSV had no data rows.'); process.exit(1); }

const header = grid[0]!.map((h) => h.trim());
const col = (match: (h: string) => boolean) => header.findIndex(match);
const iDate    = col((h) => h === 'Date');
const iDay     = col((h) => h === 'Day');
const iTitle   = col((h) => h.startsWith('Post Title'));
const iCat     = col((h) => h === 'Category');
const iPillar  = col((h) => h === 'Pillar');
const iFormat  = col((h) => h === 'Format');
const iTime    = col((h) => h === 'Posting Time');
const iWho     = col((h) => h === 'Who Posts');
const iComp    = col((h) => h.startsWith('Competitor Insight'));
const iCaption = col((h) => h === 'Sprigly Draft Caption');
const iNotes   = col((h) => h.startsWith('Sprigly Notes'));

const at = (r: string[], idx: number) => (idx >= 0 ? (r[idx] ?? '').trim() : '');

const rows: NewContentCyclePostRow[] = [];
let skipped = 0;
for (let i = 1; i < grid.length; i++) {
  const r = grid[i]!;
  const iso = isoDateInMonth(at(r, iDate), targetMonth);
  if (!iso) { skipped++; continue; }
  rows.push({
    cycleId:       cycle.id,
    clientId:      client.id,
    channel,
    scheduledDate: iso,
    format:        mapFormat(at(r, iFormat)),
    pillar:        at(r, iPillar) || null,
    caption:       at(r, iCaption) || null,
    status:        'planned',
    position:      i - 1,
    sourceMeta: {
      title:             at(r, iTitle),
      category:          at(r, iCat),
      postingTime:       at(r, iTime),
      whoPosts:          at(r, iWho),
      competitorInsight: at(r, iComp),
      notes:             at(r, iNotes),
      day:               at(r, iDay),
      clientWritesOwn:   at(r, iCaption) === '',
    },
  });
}

await db.transaction(async (tx) => {
  await tx.delete(contentCyclePosts).where(eq(contentCyclePosts.cycleId, cycle.id));
  if (rows.length > 0) await tx.insert(contentCyclePosts).values(rows);
});

console.log(`Backfilled ${rows.length} posts for cycle ${cycle.id}${skipped ? ` (${skipped} undated rows skipped)` : ''}.`);
process.exit(0);
