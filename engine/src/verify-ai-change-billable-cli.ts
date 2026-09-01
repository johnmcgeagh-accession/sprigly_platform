/**
 * verify-ai-change-billable.ts — the allowance count, exercised against a real database (0094).
 *
 * The unit tests pin what each writer STAMPS. This pins what `readAiChangeUsage` COUNTS, which
 * is a SQL question — a WHERE clause, a join and a month boundary — and therefore not something
 * a mock can answer. It reproduces ivy-t's August shape exactly (20 client rows, then 30 written
 * by the cutoff fan-out) and asserts the count reads 20 rather than 50.
 *
 * ── Everything happens inside ONE transaction, which is ROLLED BACK ───────────────────
 *
 * It seeds a scratch client, channel, cycle and posts, runs the real read against them, prints
 * the numbers, and then throws to abort. Nothing survives the run — no scratch client, no
 * orphan cycle, no rows to clean up by hand. That is what makes it safe to point at UAT.
 *
 * It refuses to run against production. See the host guard below.
 *
 * ── Why it lives in the WORKER and not in @sprigly/db ────────────────────────────────
 *
 * It needs both halves of the rule: the COUNT (`readAiChangeUsage`, @sprigly/db) and what the
 * count MEANS (`isCapReached`, @sprigly/engine). The dependency direction is engine → db and
 * db is a leaf, so a script in @sprigly/db cannot reach the predicate — and restating it there
 * would put a second copy of the cap rule in the package the first copy exists to keep out of.
 * The worker already depends on both, so it is the only place both are legitimately in scope.
 *
 *   pnpm --filter @sprigly/worker verify:billable
 */
import { sql } from 'drizzle-orm';
import { db, readAiChangeUsage } from '@sprigly/db';
import { isCapReached } from '@sprigly/engine/ai-change-cap';

/**
 * PRODUCTION REFUSAL. This script writes — even though it rolls back, it takes row locks and
 * burns sequence values — so it must never point at prod. The check is on the host because
 * that is the fact that differs: UAT is hayabusa, production is yamabiko.
 */
function assertNotProd(): void {
  const url = process.env['DATABASE_URL'] ?? '';
  const host = /@([^:/]+)/.exec(url)?.[1] ?? '(unknown)';
  if (/yamabiko/i.test(host)) {
    console.error(`REFUSING TO RUN: ${host} is production.`);
    process.exit(1);
  }
  console.log(`database host: ${host}`);
}

const ok   = (s: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${s}`);
const bad  = (s: string) => { console.log(`  \x1b[31mFAIL\x1b[0m  ${s}`); failures++; };
const head = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
let failures = 0;

const eq = (label: string, actual: unknown, expected: unknown) =>
  (actual === expected ? ok : bad)(`${label}: ${String(actual)}${actual === expected ? '' : ` (expected ${String(expected)})`}`);

/** A sentinel the rollback makes irrelevant, but which makes the rows obvious if it ever leaks. */
const TAG = 'verify-0094-scratch';

async function main(): Promise<void> {
  assertNotProd();

  await db.transaction(async (tx) => {
    // ── seed ────────────────────────────────────────────────────────────────────────
    const [client] = await tx.execute(sql`
      INSERT INTO clients (name, slug, status) VALUES (${TAG}, ${TAG}, 'active') RETURNING id
    `) as unknown as { id: string }[];
    const clientId = client!.id;

    await tx.execute(sql`
      INSERT INTO client_channels (client_id, channel, ai_change_limit)
      VALUES (${clientId}, 'instagram', 30)
    `);

    // TWO cycles, as ivy-t had: her own changes landed on the July cycle, the cutoff fan-out
    // wrote to the August one. The count pools them by (client, channel) — that is correct
    // and deliberately unchanged here.
    const [julCyc] = await tx.execute(sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status)
      VALUES (${clientId}, 'instagram', '2026-07', 'workbook_built') RETURNING id
    `) as unknown as { id: string }[];
    const [augCyc] = await tx.execute(sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status)
      VALUES (${clientId}, 'instagram', '2026-08', 'workbook_built') RETURNING id
    `) as unknown as { id: string }[];

    const mkPost = async (cycleId: string, date: string): Promise<string> => {
      const [p] = await tx.execute(sql`
        INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, status, pillar)
        VALUES (${clientId}, ${cycleId}, 'instagram', ${date}, 'single', 'new', 'Everyday Ritual')
        RETURNING id
      `) as unknown as { id: string }[];
      return p!.id;
    };

    /** One counted-or-not row, written the way the real writers write it. */
    const edit = async (
      cycleId: string, postId: string, at: string,
      actor: 'client' | 'agent', billable: boolean,
    ) => {
      await tx.execute(sql`
        INSERT INTO post_edits (post_id, cycle_id, scope, instruction, caption_before, caption_after, passed, actor, billable, created_at)
        VALUES (${postId}, ${cycleId}, 'post', ${TAG}, 'before', 'after', true, ${actor}, ${billable}, ${at}::timestamp)
      `);
    };

    const julPost = await mkPost(julCyc!.id, '2026-08-20');
    const augPost = await mkPost(augCyc!.id, '2026-09-05');

    const AUG = new Date('2026-08-31T12:00:00Z');
    const usage = () => readAiChangeUsage(tx as never, clientId, 'instagram', AUG);

    // ── 1. baseline ─────────────────────────────────────────────────────────────────
    head('1. a fresh month counts nothing');
    eq('used', (await usage()).used, 0);

    // ── 2. a client rewrite counts ──────────────────────────────────────────────────
    head('2. a CLIENT caption rewrite counts — before and after');
    const before2 = (await usage()).used;
    await edit(julCyc!.id, julPost, '2026-08-03 05:17:07', 'client', true);
    const after2 = (await usage()).used;
    console.log(`        before: ${before2}   after: ${after2}`);
    eq('one client rewrite adds exactly one', after2 - before2, 1);

    // ── 3. a system fan-out does not ────────────────────────────────────────────────
    head('3. a SYSTEM fan-out generation does NOT count — unchanged across a 30-post run');
    const before3 = (await usage()).used;
    for (let i = 0; i < 30; i++) {
      await edit(augCyc!.id, augPost, '2026-08-24 04:00:12', 'agent', false);
    }
    const after3 = (await usage()).used;
    console.log(`        before: ${before3}   after 30 fan-out rows: ${after3}`);
    eq('the count did not move', after3, before3);
    const [rowCount] = await tx.execute(sql`
      SELECT count(*)::int AS n FROM post_edits WHERE cycle_id = ${augCyc!.id}
    `) as unknown as { n: number }[];
    eq('but the rows EXIST — exempt at the count, not at the write', rowCount!.n, 30);

    // ── 4. the prod shape ───────────────────────────────────────────────────────────
    head('4. ivy-t’s August, reproduced: 20 client rows + 30 fan-out rows');
    await tx.execute(sql`DELETE FROM post_edits WHERE instruction = ${TAG}`);
    for (let i = 0; i < 20; i++) await edit(julCyc!.id, julPost, '2026-08-11 11:33:12', 'client', true);
    for (let i = 0; i < 30; i++) await edit(augCyc!.id, augPost, '2026-08-24 04:00:12', 'agent', false);

    const u4 = await usage();
    const [total4] = await tx.execute(sql`
      SELECT count(*)::int AS n FROM post_edits WHERE instruction = ${TAG} AND passed
    `) as unknown as { n: number }[];
    console.log(`        rows written: ${total4!.n}    counted: ${u4.used}    limit: ${u4.limit}`);
    eq('counted', u4.used, 20);
    eq('NOT the old 50', u4.used === 50, false);
    eq('cap reached', isCapReached(u4, AUG), false);
    eq('she has changes left', u4.limit - u4.used, 10);

    // ── 5. the cap still bites ──────────────────────────────────────────────────────
    head('5. 30 CLIENT changes in the month → still refused');
    await tx.execute(sql`DELETE FROM post_edits WHERE instruction = ${TAG}`);
    for (let i = 0; i < 30; i++) await edit(julCyc!.id, julPost, '2026-08-11 11:33:12', 'client', true);
    const u5 = await usage();
    console.log(`        counted: ${u5.used}  limit: ${u5.limit}`);
    eq('used', u5.used, 30);
    eq('cap reached', isCapReached(u5, AUG), true);

    // ── 6. the override still waives ────────────────────────────────────────────────
    head('6. an override in the future still waives, unchanged');
    await tx.execute(sql`
      UPDATE client_channels SET ai_change_limit_override_until = '2026-10-01T12:04:45Z'
      WHERE client_id = ${clientId} AND channel = 'instagram'
    `);
    const u6 = await usage();
    console.log(`        counted: ${u6.used}  unlimited: ${u6.unlimited}`);
    eq('used is still counted honestly', u6.used, 30);
    eq('unlimited', u6.unlimited, true);
    eq('cap NOT reached', isCapReached(u6, AUG), false);
    await tx.execute(sql`
      UPDATE client_channels SET ai_change_limit_override_until = NULL
      WHERE client_id = ${clientId} AND channel = 'instagram'
    `);

    // ── 7. the sweep's row ──────────────────────────────────────────────────────────
    head('7. a swept CLIENT change (actor agent, billable true) still counts');
    await tx.execute(sql`DELETE FROM post_edits WHERE instruction = ${TAG}`);
    // This is the shape the sweep writes when it recovers a client's rewrite: attributed to
    // the agent, because it is not her engagement — billed to her, because it is her change.
    await edit(julCyc!.id, julPost, '2026-08-15 09:00:00', 'agent', true);
    const u7 = await usage();
    console.log(`        actor=agent, billable=true → counted: ${u7.used}`);
    eq('counted', u7.used, 1);

    // ── 8. the window is untouched ──────────────────────────────────────────────────
    head('8. the month window and the (client, channel) scope are unchanged');
    await tx.execute(sql`DELETE FROM post_edits WHERE instruction = ${TAG}`);
    await edit(julCyc!.id, julPost, '2026-07-31 23:59:59', 'client', true);   // previous month
    await edit(julCyc!.id, julPost, '2026-08-01 00:00:00', 'client', true);   // in window
    const u8 = await usage();
    console.log(`        one row on 31 Jul, one on 1 Aug → counted: ${u8.used}`);
    eq('only the in-window row counts', u8.used, 1);
    eq('resets on the 1st of next month', u8.resetsOn.slice(0, 10), '2026-09-01');

    // ── rollback ────────────────────────────────────────────────────────────────────
    throw new Error('__rollback__');
  }).catch((e: unknown) => {
    if (!(e instanceof Error) || e.message !== '__rollback__') throw e;
    console.log('\n(transaction rolled back — nothing was persisted)');
  });

  console.log(failures === 0 ? '\n\x1b[32mALL CHECKS PASSED\x1b[0m' : `\n\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
