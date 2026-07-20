/**
 * plan-merge-dryrun.ts — Phase 1 dry-run for the edit-aware regen merge.
 *
 * Reads a cycle's current content_cycle_posts + post_edits refs + persisted
 * structured_brief + catalogue, runs the pure classifier (plan-merge.ts), and prints
 * which posts would be PRESERVED (with review state + orphan flag), DROPPED, or
 * REPLACED by the new plan. READ-ONLY: no writes, no deletes, no DB apply, no
 * delivery. NOT for committing.
 *
 * Run:
 *   cd engine && set -a && . ../.env.local && set +a && \
 *     pnpm exec tsx src/content-cycles/plan-merge-dryrun.ts [cycleId]
 */

import { eq, and, asc } from 'drizzle-orm';
import { db, contentCyclePosts, contentCycles, postEdits, clientProductCatalogue } from '@sprigly/db';
import type { Catalogue } from '../catalogue/parse-catalogue.js';
import type { StructuredBrief } from '@sprigly/engine';
import { mergePlan, type ExistingPost } from './plan-merge.js';

// Required, no fallback: this used to default to a real production cycle, so a bare
// invocation silently reported on someone else's month.
const cycleId = process.argv[2];
if (!cycleId) {
  console.error('plan-merge-dryrun: missing required argument <cycleId>.');
  console.error('usage: pnpm exec tsx src/content-cycles/plan-merge-dryrun.ts <cycleId>');
  process.exit(1);
}
const AMBIGUOUS = new Set(['ivy']);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const snip = (s: string | null, n = 66) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const [cyc] = await db
  .select({ clientId: contentCycles.clientId, channel: contentCycles.channel, brief: contentCycles.structuredBrief })
  .from(contentCycles).where(eq(contentCycles.id, cycleId)).limit(1);
if (!cyc) { console.error(`cycle ${cycleId} not found`); process.exit(1); }

const rows = await db
  .select({
    id: contentCyclePosts.id, scheduledDate: contentCyclePosts.scheduledDate,
    status: contentCyclePosts.status, caption: contentCyclePosts.caption,
    sourceMeta: contentCyclePosts.sourceMeta, position: contentCyclePosts.position,
    hook: contentCyclePosts.hook, script: contentCyclePosts.script,
  })
  .from(contentCyclePosts)
  .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, cyc.clientId)))
  .orderBy(asc(contentCyclePosts.scheduledDate), asc(contentCyclePosts.position));

const editRows = await db.select({ postId: postEdits.postId }).from(postEdits).where(eq(postEdits.cycleId, cycleId));
const editedIds = new Set(editRows.map((r) => r.postId));

const [catRow] = await db
  .select({ catalogue: clientProductCatalogue.catalogue })
  .from(clientProductCatalogue)
  .where(and(eq(clientProductCatalogue.clientId, cyc.clientId), eq(clientProductCatalogue.channel, cyc.channel)))
  .limit(1);
const catalogue = (catRow?.catalogue ?? { families: [] }) as unknown as Catalogue;
const catalogueNames = catalogue.families.map((f) => f.name.toLowerCase().trim()).filter((n) => n && !AMBIGUOUS.has(n));

// Briefed universe: every catalogue name mentioned ANYWHERE in the brief (products,
// schedule, content_asks, focus) — so a post naming a briefed product (or the founder
// 'Sally', who is a scheduled product) is not mis-flagged as orphaned.
const brief = (cyc.brief ?? null) as StructuredBrief | null;
const briefStrings: string[] = [];
for (const p of brief?.products ?? []) briefStrings.push(p.product);
for (const b of brief?.schedule ?? []) if (b.product) briefStrings.push(b.product);
for (const a of brief?.content_asks ?? []) if (a.product) briefStrings.push(a.product);
for (const f of brief?.focus ?? []) briefStrings.push(f);
const briefLower = briefStrings.map((s) => s.toLowerCase());
const briefedProducts = catalogueNames.filter((n) => briefLower.some((s) => new RegExp('\\b' + escapeRe(n) + '\\b').test(s)));

const existing: ExistingPost[] = rows.map((r) => ({
  id: r.id,
  scheduledDate: r.scheduledDate,
  status: r.status,
  caption: r.caption,
  title: ((r.sourceMeta as Record<string, unknown> | null)?.['title'] as string) ?? '',
  hasPostEdit: editedIds.has(r.id),
  hasHook: !!(r.hook && r.hook.trim()),
  hasScript: !!(r.script && r.script.trim()),
}));

const dec = mergePlan({ existing, briefedProducts, catalogueNames });

console.log('');
console.log(`DRY-RUN — edit-aware regen merge for cycle ${cycleId}`);
console.log(`existing posts: ${existing.length}   post_edits-referenced: ${editedIds.size}`);
console.log(`briefed products (from structured brief): [${briefedProducts.join(', ') || 'none'}]`);
console.log('');

console.log(`PRESERVE — kept from client work, flagged for review (${dec.preserve.length}):`);
for (const d of dec.preserve) {
  console.log(`  ${d.post.scheduledDate}  ${d.post.status.padEnd(7)}  ${d.reviewState.padEnd(21)}  products:[${d.products.join(',')}]`);
  console.log(`      "${snip(d.post.caption)}…"   — ${d.reason}`);
}
console.log('');
console.log(`DROP — disposable empty placeholders (${dec.drop.length}):`);
for (const d of dec.drop) console.log(`  ${d.post.scheduledDate}  ${d.post.status}  "${snip(d.post.caption, 40)}"  — ${d.reason}`);
console.log('');
console.log(`REPLACE — un-edited posts removed, new plan fills their place as 'regenerated' (${dec.replace.length}):`);
console.log(`  dates: ${dec.replace.map((d) => d.post.scheduledDate).join(', ')}`);
console.log('');
console.log('SUMMARY');
console.log(`  preserve ${dec.preserve.length} (orphan ${dec.preserve.filter((d) => d.orphaned).length})  |  drop ${dec.drop.length}  |  replace ${dec.replace.length}`);
console.log(`  FK-safety: every deleted post (drop+replace) is post_edits-free? ${[...dec.drop, ...dec.replace].every((d) => !d.post.hasPostEdit)}`);
console.log('  (new plan posts that fill the REPLACE slots come from the regen CSV/workbook, inserted as review_state=regenerated — not enumerated here.)');
console.log('');
process.exit(0);
