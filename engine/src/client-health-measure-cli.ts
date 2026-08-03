/**
 * client-health-measure-cli.ts — what the adoption/divergence read actually costs.
 *
 * The decision it informs (computed-on-read vs a materialised table) is recorded in
 * admin/src/lib/client-health.ts and docs/reports/client-health-metrics.md. Kept in the repo so
 * the next person to ask "is this still cheap enough?" runs it rather than guessing.
 *
 *   pnpm --filter @sprigly/worker client-health-measure <client-slug> [channel]
 *
 * It DUPLICATES the loader in admin/src/lib/client-health.ts rather than importing it, because
 * that module is a React server component's dependency and pulls `react` in behind it. The chain
 * rule is the thing that must not drift, and it is asserted in caption-overlap.test.ts; what is
 * copied here is the four queries, which the numbers below are about.
 *
 * Reports query time and scoring time separately: they scale differently, and the choice between
 * on-read and materialised turns on the second one.
 */
import { db, clients, igPosts, contentCyclePosts, postEdits, planActivity } from '@sprigly/db';
import { and, eq, isNull, inArray, asc } from 'drizzle-orm';
import { buildPool, monthHealth, tokenise, type SpriglyCaptionChain, type PublishedCaption } from '@sprigly/engine/caption-overlap';

const slug = process.argv[2] ?? 'ivy-t';
const channel = process.argv[3] ?? 'instagram';

async function main() {
  const client = (await db.select().from(clients).where(eq(clients.slug, slug)).limit(1))[0];
  if (!client) throw new Error(`no client with slug ${slug}`);

  const t0 = performance.now();
  const [igRows, posts] = await Promise.all([
    db.select({ month: igPosts.month, posts: igPosts.posts })
      .from(igPosts).where(and(eq(igPosts.clientId, client.id), eq(igPosts.channel, channel))),
    db.select({ id: contentCyclePosts.id, scheduledDate: contentCyclePosts.scheduledDate, caption: contentCyclePosts.caption, sourceMeta: contentCyclePosts.sourceMeta })
      .from(contentCyclePosts).where(and(
        eq(contentCyclePosts.clientId, client.id),
        eq(contentCyclePosts.channel, channel),
        isNull(contentCyclePosts.deletedAt),
      )),
  ]);
  const ids = posts.map((p) => p.id);
  const [reshapeRows, typedRows] = ids.length ? await Promise.all([
    db.select({ postId: postEdits.postId, captionAfter: postEdits.captionAfter })
      .from(postEdits).where(and(inArray(postEdits.postId, ids), eq(postEdits.passed, true)))
      .orderBy(asc(postEdits.createdAt)),
    db.select({ postId: planActivity.postId })
      .from(planActivity).where(and(
        eq(planActivity.clientId, client.id),
        eq(planActivity.action, 'caption_saved'),
        eq(planActivity.origin, 'user'),
      )),
  ]) : [[], []];
  const queryMs = performance.now() - t0;

  const reshapesByPost = new Map<string, string[]>();
  for (const r of reshapeRows) {
    const text = (r.captionAfter ?? '').trim();
    if (!text) continue;
    reshapesByPost.set(r.postId, [...(reshapesByPost.get(r.postId) ?? []), text]);
  }
  const typedOver = new Set(typedRows.map((r) => r.postId).filter((x): x is string => !!x));

  const chains: SpriglyCaptionChain[] = posts.map((p) => {
    const variants: string[] = [];
    const baseline = (p.sourceMeta as { original?: { caption?: unknown } } | null)?.original?.caption;
    if (typeof baseline === 'string' && baseline.trim()) variants.push(baseline);
    for (const r of reshapesByPost.get(p.id) ?? []) variants.push(r);
    const live = (p.caption ?? '').trim();
    if (live && !typedOver.has(p.id)) variants.push(live);
    return { postId: p.id, scheduledDate: p.scheduledDate, variants };
  });

  const months = igRows.map((row) => ({
    month: row.month,
    published: ((row.posts as Array<Record<string, unknown>> | null) ?? [])
      .filter((p) => typeof p['timestamp'] === 'string' && (p['timestamp'] as string).startsWith(row.month))
      .map((p): PublishedCaption => ({ timestamp: p['timestamp'] as string, caption: typeof p['caption'] === 'string' ? p['caption'] : null })),
  }));

  const variants = chains.reduce((a, c) => a + c.variants.length, 0);
  const publishedTotal = months.reduce((a, m) => a + m.published.length, 0);
  const planWords = chains.reduce((a, c) => a + c.variants.reduce((b, v) => b + tokenise(v).length, 0), 0);

  // Warm, then measure — the first pass pays for JIT and would flatter a materialised table.
  const RUNS = 20;
  buildPool(chains);
  const tPool = performance.now();
  for (let i = 0; i < RUNS; i++) buildPool(chains);
  const poolMs = (performance.now() - tPool) / RUNS;

  const pool = buildPool(chains);
  for (const m of months) monthHealth(m.month, m.published, pool);
  const t1 = performance.now();
  for (let i = 0; i < RUNS; i++) { const p = buildPool(chains); for (const m of months) monthHealth(m.month, m.published, p); }
  const allMonthsMs = (performance.now() - t1) / RUNS;

  const newest = [...months].sort((a, b) => b.month.localeCompare(a.month))[0];
  const t2 = performance.now();
  if (newest) for (let i = 0; i < RUNS; i++) { const p = buildPool(chains); monthHealth(newest.month, newest.published, p); }
  const oneMonthMs = (performance.now() - t2) / RUNS;

  // What the naive shape costs: a pool rebuilt inside every month.
  const t3 = performance.now();
  for (let i = 0; i < RUNS; i++) for (const m of months) monthHealth(m.month, m.published, chains);
  const naiveMs = (performance.now() - t3) / RUNS;

  console.log(`client            ${slug} / ${channel}`);
  console.log(`trawled months    ${months.length}`);
  console.log(`published caps    ${publishedTotal}`);
  console.log(`plan posts        ${chains.length}  (${chains.filter((c) => !c.variants.length).length} with no Sprigly text)`);
  console.log(`Sprigly variants  ${variants}  (${planWords} words)`);
  console.log(`comparisons       ${publishedTotal * variants} for the whole history`);
  console.log(`query time        ${queryMs.toFixed(1)}ms  (4 queries, 2 round trips)`);
  console.log(`buildPool         ${poolMs.toFixed(1)}ms  (mean of ${RUNS})`);
  console.log(`score, all months ${allMonthsMs.toFixed(1)}ms  (pool + ${months.length} months, mean of ${RUNS})`);
  console.log(`score, one month  ${oneMonthMs.toFixed(2)}ms  (pool + ${newest?.month ?? '—'}, mean of ${RUNS})`);
  console.log(`  vs pool-per-mth ${naiveMs.toFixed(1)}ms  (the shape buildPool exists to avoid)`);
  console.log(`\nper month:`);
  for (const m of [...months].sort((a, b) => b.month.localeCompare(a.month))) {
    const h = monthHealth(m.month, m.published, pool);
    if (h.state !== 'measured') { console.log(`  ${h.month}  ${h.state}`); continue; }
    const div = h.divergence === null ? '—' : `${(h.divergence * 100).toFixed(1)}%`;
    console.log(`  ${h.month}  ${String(h.matched).padStart(2)} of ${String(h.published).padStart(2)}  adoption ${(h.adoption * 100).toFixed(1).padStart(5)}%  divergence ${div.padStart(6)}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
