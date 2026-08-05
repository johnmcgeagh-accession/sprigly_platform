/**
 * backfill-posts-cli.ts — one-off, MANUAL backfill of content_cycle_posts from an
 * already-generated plan CSV on Drive (the cycle's draft_csv_ref). Use this to
 * populate the structured rows for a cycle that was planned BEFORE the dual-write
 * existed (e.g. the current IVY-t cycle), so app/ can render it.
 *
 * Future planning runs populate content_cycle_posts directly via the dual-write in
 * planning.ts; this is only for catching up existing cycles.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker backfill-posts <client-slug> <channel> [cycle-month]
 *   pnpm --filter @sprigly/worker backfill-posts <client-slug> <channel> [cycle-month] --confirm
 *
 *   cycle-month (YYYY-MM, the cycle's DATA month) is optional — if omitted, the
 *   most recent cycle for that client/channel with a draft CSV is used.
 *
 * DRY RUN IS THE DEFAULT; --confirm is the only way to write. This deletes every
 * content_cycle_post in the target cycle before reinserting from the CSV, and its
 * connection comes from the package script's `. ../.env.local`, i.e. UAT — the same
 * copied idiom every other engine CLI carries, chosen for none of them because it was
 * safe. Worse, with cycle-month omitted the tool CHOOSES the cycle for you. A destructive
 * tool that does the dangerous thing when you forget an argument is a bad tool, so the
 * dry run prints the cycle it resolved and what it would delete, and stops.
 *
 * (No host assertion here, unlike the e2e seed: this one legitimately targets a remote
 * database. The guard it needed was a confirmation, not an allowlist.)
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

// Flags are stripped before positional binding, so `backfill-posts ivy-t instagram
// --confirm` cannot land "--confirm" in monthArg and silently retarget the cycle.
const argv = process.argv.slice(2);
const [slug, channel, monthArg] = argv.filter((a) => !a.startsWith('--'));
const confirm = argv.includes('--confirm');

if (!slug || !channel) {
  console.error('Usage: pnpm --filter @sprigly/worker backfill-posts <client-slug> <channel> [cycle-month] [--confirm]');
  console.error('       (default: DRY RUN — nothing is written)');
  process.exit(1);
}
if (argv.includes('--dry-run') && confirm) {
  console.error('refusing: --dry-run and --confirm are contradictory');
  process.exit(2);
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
// Print the RESOLVED cycle before doing anything. When cycle-month is omitted this tool
// picks the target itself, so "which cycle" is the fact most worth seeing first.
console.log(`client  ${slug}/${channel}`);
console.log(`cycle   ${cycle.id} — data ${cycle.cycleMonth} → plan ${targetMonth}${monthArg ? '' : '  (resolved: most recent with a draft CSV)'}`);
console.log(`mode    ${confirm ? 'CONFIRM — will delete and reinsert' : 'DRY RUN — no writes'}\n`);

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
      // Original as-generated values, so the app's "revert" can restore them.
      original: {
        caption:       at(r, iCaption),
        format:        mapFormat(at(r, iFormat)),
        pillar:        at(r, iPillar),
        scheduledDate: iso,
        position:      i - 1,
      },
    },
  });
}

// Everything above this line is read-only (Drive download + CSV parse), so the dry run
// reports the real numbers rather than a guess at them.
const existing = await db.select({ id: contentCyclePosts.id }).from(contentCyclePosts)
  .where(eq(contentCyclePosts.cycleId, cycle.id));

console.log(`delete  ${existing.length} existing post(s) in this cycle`);
console.log(`insert  ${rows.length} post(s) from the CSV${skipped ? ` (${skipped} undated rows skipped)` : ''}`);

if (!confirm) {
  console.log('\nDRY RUN — nothing was written. Re-run with --confirm to apply.');
  process.exit(0);
}

await db.transaction(async (tx) => {
  await tx.delete(contentCyclePosts).where(eq(contentCyclePosts.cycleId, cycle.id));
  if (rows.length > 0) await tx.insert(contentCyclePosts).values(rows);
});

console.log(`\nBackfilled ${rows.length} posts for cycle ${cycle.id}${skipped ? ` (${skipped} undated rows skipped)` : ''}.`);
process.exit(0);
