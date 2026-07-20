/**
 * merge-apply-cli.ts — apply the edit-aware regen merge to an existing cycle's
 * content_cycle_posts, using the CONFIRMED plan CSV already on Drive (draft_csv_ref)
 * as the new plan. Same classifier (plan-merge.ts) as the production planning path,
 * so it PRESERVES client-edited posts and DELETES only the un-edited + placeholder
 * rows (all post_edits-free).
 *
 * DRY BY DEFAULT: prints the exact WRITE PLAN (delete ids / preserve ids+review_state
 * / insert set) and asserts FK-safety, writing NOTHING. Pass --write to commit — the
 * write touches review_state + posts_sync_status + posts_synced_at/run_id, so it
 * REQUIRES migrations 0059, 0060 and 0061 applied.
 *
 * Run (dry):   cd engine && set -a && . ../.env.local && set +a && \
 *                pnpm exec tsx src/content-cycles/merge-apply-cli.ts <cycleId>
 * Run (write): ... merge-apply-cli.ts <cycleId> --write
 */
import { randomUUID } from 'node:crypto';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db, contentCycles, contentCyclePosts, postEdits, clientProductCatalogue, stampPostsSyncStatus } from '@sprigly/db';
import type { NewContentCyclePostRow } from '@sprigly/db';
import { getTokens, storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { StructuredBrief } from '@sprigly/engine';
import type { Catalogue } from '../catalogue/parse-catalogue.js';
import { nextMonth } from './planning.js';
import { mapFormat, isoDateInMonth } from './post-mapping.js';
import { mergePlan, briefedProductNames, type ExistingPost } from './plan-merge.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const cycleId = args.find((a) => !a.startsWith('--')) ?? 'd502f22d-983b-442c-880a-db4f86861ecb';
const snip = (s: string | null, n = 58) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Quote-aware CSV parser (embedded newlines + "" escapes) — mirrors backfill-posts. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
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

const [cycle] = await db
  .select({
    id: contentCycles.id, clientId: contentCycles.clientId, channel: contentCycles.channel,
    cycleMonth: contentCycles.cycleMonth, draftCsvRef: contentCycles.draftCsvRef, brief: contentCycles.structuredBrief,
  })
  .from(contentCycles).where(eq(contentCycles.id, cycleId)).limit(1);
if (!cycle) { console.error(`cycle ${cycleId} not found`); process.exit(1); }
if (!cycle.draftCsvRef) { console.error(`cycle ${cycleId} has no draft_csv_ref — no plan CSV to merge`); process.exit(1); }
const targetMonth = nextMonth(cycle.cycleMonth);

// ── New plan from the confirmed Drive CSV ─────────────────────────────────────
const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, cycle.clientId, 'drive');
if (!tokens) { console.error(`no Drive tokens for client ${cycle.clientId}`); process.exit(1); }
const drive = new DriveApiClient(
  process.env.GOOGLE_CLIENT_ID ?? '', process.env.GOOGLE_CLIENT_SECRET ?? '', tokens,
  (refreshed) => storeTokens(db, encProvider, cycle.clientId, 'drive', refreshed),
);
const grid = parseCsv((await drive.downloadFile(cycle.draftCsvRef)).toString('utf-8'));
if (grid.length < 2) { console.error('CSV had no data rows'); process.exit(1); }
const header = grid[0]!.map((h) => h.trim());
const col = (m: (h: string) => boolean) => header.findIndex(m);
const iDate = col((h) => h === 'Date'), iDay = col((h) => h === 'Day'), iTitle = col((h) => h.startsWith('Post Title'));
const iCat = col((h) => h === 'Category'), iPillar = col((h) => h === 'Pillar'), iFormat = col((h) => h === 'Format');
const iTime = col((h) => h === 'Posting Time'), iWho = col((h) => h === 'Who Posts'), iComp = col((h) => h.startsWith('Competitor Insight'));
const iCaption = col((h) => h === 'Sprigly Draft Caption'), iNotes = col((h) => h.startsWith('Sprigly Notes'));
const at = (r: string[], idx: number) => (idx >= 0 ? (r[idx] ?? '').trim() : '');

const newRows: NewContentCyclePostRow[] = [];
for (let i = 1; i < grid.length; i++) {
  const r = grid[i]!;
  const iso = isoDateInMonth(at(r, iDate), targetMonth);
  if (!iso) continue;
  newRows.push({
    cycleId: cycle.id, clientId: cycle.clientId, channel: cycle.channel, scheduledDate: iso,
    format: mapFormat(at(r, iFormat)), pillar: at(r, iPillar) || null, caption: at(r, iCaption) || null,
    status: 'planned', reviewState: 'regenerated', position: i - 1,
    sourceMeta: {
      title: at(r, iTitle), category: at(r, iCat), postingTime: at(r, iTime), whoPosts: at(r, iWho),
      competitorInsight: at(r, iComp), notes: at(r, iNotes), day: at(r, iDay), clientWritesOwn: at(r, iCaption) === '',
      original: { caption: at(r, iCaption), format: mapFormat(at(r, iFormat)), pillar: at(r, iPillar), scheduledDate: iso, position: i - 1 },
    },
  });
}

// ── Classify existing posts (explicit columns; no select-all) ─────────────────
const existingRows = await db
  .select({ id: contentCyclePosts.id, scheduledDate: contentCyclePosts.scheduledDate, status: contentCyclePosts.status,
            caption: contentCyclePosts.caption, sourceMeta: contentCyclePosts.sourceMeta,
            hook: contentCyclePosts.hook, script: contentCyclePosts.script })
  .from(contentCyclePosts).where(eq(contentCyclePosts.cycleId, cycle.id));
const editRefs = await db.select({ postId: postEdits.postId }).from(postEdits).where(eq(postEdits.cycleId, cycle.id));
const editedIds = new Set(editRefs.map((r) => r.postId));
const [catRow] = await db.select({ catalogue: clientProductCatalogue.catalogue }).from(clientProductCatalogue)
  .where(and(eq(clientProductCatalogue.clientId, cycle.clientId), eq(clientProductCatalogue.channel, cycle.channel))).limit(1);
const catalogueNames = (((catRow?.catalogue ?? { families: [] }) as unknown as Catalogue).families ?? [])
  .map((f) => f.name.toLowerCase().trim()).filter((n) => n && n !== 'ivy');
const existing: ExistingPost[] = existingRows.map((r) => ({
  id: r.id, scheduledDate: r.scheduledDate, status: r.status, caption: r.caption,
  title: ((r.sourceMeta as Record<string, unknown> | null)?.['title'] as string) ?? '', hasPostEdit: editedIds.has(r.id),
  hasHook: !!(r.hook && r.hook.trim()), hasScript: !!(r.script && r.script.trim()),
}));
const dec = mergePlan({ existing, briefedProducts: briefedProductNames(cycle.brief as StructuredBrief | null, catalogueNames), catalogueNames });
const deleteIds = [...dec.drop, ...dec.replace].map((d) => d.post.id);
const fkSafe = [...dec.drop, ...dec.replace].every((d) => !d.post.hasPostEdit);

// ── WRITE PLAN ────────────────────────────────────────────────────────────────
console.log(`\nWRITE PLAN — edit-aware merge for cycle ${cycle.id}  (${write ? 'WRITE' : 'DRY — nothing written'})`);
console.log(`new plan from CSV: ${newRows.length} posts, dates ${newRows[0]?.scheduledDate}..${newRows[newRows.length - 1]?.scheduledDate}\n`);
console.log(`PRESERVE (kept, review_state set) — ${dec.preserve.length}:`);
for (const d of dec.preserve) console.log(`  keep  ${d.post.id}  ${d.post.scheduledDate}  -> review_state=${d.reviewState}   "${snip(d.post.caption)}…"`);
console.log(`\nDELETE (drop ${dec.drop.length} + replace ${dec.replace.length}) — ${deleteIds.length} rows, all post_edits-free:`);
for (const d of dec.drop) console.log(`  del   ${d.post.id}  ${d.post.scheduledDate}  [placeholder]`);
for (const d of dec.replace) console.log(`  del   ${d.post.id}  ${d.post.scheduledDate}  [un-edited]`);
console.log(`\nINSERT — ${newRows.length} new posts as review_state=regenerated (dates: ${newRows.map((r) => r.scheduledDate).join(', ')})`);
console.log(`\nFK-safe (no deleted row is post_edits-referenced): ${fkSafe}`);
console.log(`post_edits-referenced posts: ${editedIds.size}  |  preserved: ${dec.preserve.length}  (must be >= ${editedIds.size})`);

if (!write) { console.log('\nDRY RUN — nothing written. Re-run with --write (after 0059 + 0060 applied) to commit.\n'); process.exit(0); }
if (!fkSafe) { console.error('\nABORT: a row marked for delete is post_edits-referenced — refusing to write.'); process.exit(1); }

// A new plan that yields zero insertable rows is a failure, not a sync — and must
// never reach the delete (a delete-only commit would wipe the live plan).
if (newRows.length === 0) { console.error('\nABORT: new plan CSV produced 0 in-month posts — refusing to write.'); process.exit(1); }

const writeRunId = randomUUID();
try {
  const insertedIds = await db.transaction(async (tx) => {
    if (deleteIds.length > 0) await tx.delete(contentCyclePosts).where(inArray(contentCyclePosts.id, deleteIds));
    for (const pr of dec.preserve) await tx.update(contentCyclePosts).set({ reviewState: pr.reviewState }).where(eq(contentCyclePosts.id, pr.post.id));
    const ins = await tx.insert(contentCyclePosts).values(newRows).returning({ id: contentCyclePosts.id });
    return ins.map((r) => r.id);
  });

  // Verify the write landed before stamping synced (parity with planning.ts).
  const liveInserted = await db.select({ id: contentCyclePosts.id }).from(contentCyclePosts)
    .where(and(inArray(contentCyclePosts.id, insertedIds), isNull(contentCyclePosts.deletedAt)));
  if (liveInserted.length !== newRows.length) throw new Error(`post-write verification failed — expected ${newRows.length} live inserted posts, found ${liveInserted.length}`);
  if (deleteIds.length > 0) {
    const survivors = await db.select({ id: contentCyclePosts.id }).from(contentCyclePosts)
      .where(and(inArray(contentCyclePosts.id, deleteIds), isNull(contentCyclePosts.deletedAt)));
    if (survivors.length > 0) throw new Error(`post-write verification failed — ${survivors.length} replace-set rows still live`);
  }

  await stampPostsSyncStatus(cycle.id, 'synced', { runId: writeRunId, syncedAt: new Date() });
  console.log(`\nWROTE (run ${writeRunId}): deleted ${deleteIds.length}, preserved ${dec.preserve.length}, inserted ${newRows.length}. posts_sync_status=synced.\n`);
  process.exit(0);
} catch (err) {
  console.error(`\nWRITE FAILED (${String(err)}) — marking cycle out_of_sync (fresh connection, will throw if that also fails)…`);
  await stampPostsSyncStatus(cycle.id, 'out_of_sync', { runId: writeRunId });
  console.error('Marked out_of_sync. No stale synced left behind.\n');
  process.exit(1);
}
