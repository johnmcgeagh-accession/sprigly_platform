/**
 * verify-banked-retire-cli.ts — the retirement pass, against a real database.
 *
 * The unit tests pin what the loop DECIDES. This pins what the SQL SELECTS, which is the half
 * a mock cannot answer: two date clauses that must partition the banked set exactly, a jsonb
 * flag test, and an IS NULL guard carrying the idempotence. It seeds ivy-t's actual shape —
 * a post banked 2026-08-30 for a 2026-08-31 promo — alongside a still-live banked post and a
 * genuine failure, and checks each lands where it should.
 *
 * Everything runs inside ONE transaction which is ROLLED BACK. Nothing survives the run.
 * It refuses to run against production; see the host guard.
 *
 *   pnpm --filter @sprigly/worker verify:retire
 */
import { sql } from 'drizzle-orm';
import { db } from '@sprigly/db';
import { retireExpiredBanked } from './content-cycles/banked-changes.js';

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

const TAG = 'verify-retire-scratch';
/** The morning after ivy-t's promo. */
const NOW = new Date('2026-09-01T05:00:00.000Z');

const logger = { info() {}, warn() {} } as never;

async function main(): Promise<void> {
  assertNotProd();

  await db.transaction(async (tx) => {
    const [client] = await tx.execute(sql`
      INSERT INTO clients (name, slug, status) VALUES (${TAG}, ${TAG}, 'active') RETURNING id
    `) as unknown as { id: string }[];
    const clientId = client!.id;

    const [cyc] = await tx.execute(sql`
      INSERT INTO content_cycles (client_id, channel, cycle_month, status)
      VALUES (${clientId}, 'instagram', '2026-07', 'workbook_built') RETURNING id
    `) as unknown as { id: string }[];
    const cycleId = cyc!.id;

    const mkPost = async (date: string, status: string, meta: unknown): Promise<string> => {
      const [p] = await tx.execute(sql`
        INSERT INTO content_cycle_posts (client_id, cycle_id, channel, scheduled_date, format, status, pillar, source_meta)
        VALUES (${clientId}, ${cycleId}, 'instagram', ${date}, 'single', ${status}, 'Launch', ${JSON.stringify(meta)}::jsonb)
        RETURNING id
      `) as unknown as { id: string }[];
      return p!.id;
    };

    const bankedMeta = (extra: Record<string, unknown> = {}) => ({
      title: 'our end of summer treat',
      quotaBanked: true,
      quotaBankedAt: '2026-08-30T15:05:17.946Z',
      pendingInstruction: 'our end of summer treat - free uk p&P ending at midnight',
      generationError: 'Waiting for your changes to refresh on 1 September.',
      ...extra,
    });

    // ivy-t's row: banked 30 Aug, dated 31 Aug, read on 1 Sep.
    const expiredId  = await mkPost('2026-08-31', 'generation_failed', bankedMeta());
    // A banked post whose day is still ahead.
    const aheadId    = await mkPost('2026-09-15', 'generation_failed', bankedMeta());
    // A genuine failure, past-dated, carrying no quota flag.
    const failedId   = await mkPost('2026-08-20', 'generation_failed', { generationError: 'the request timed out', generationSweepAttempts: 2 });
    // Already retired on an earlier tick.
    const doneId     = await mkPost('2026-08-10', 'generation_expired', { quotaExpiredAt: '2026-08-11T05:00:00.000Z', generationError: 'already retired' });

    // NB raw execute returns timestamps as strings, not Dates — compared as strings below.
    const readPost = async (id: string) => {
      const [r] = await tx.execute(sql`
        SELECT status, source_meta, updated_at FROM content_cycle_posts WHERE id = ${id}
      `) as unknown as { status: string; source_meta: Record<string, unknown>; updated_at: string }[];
      return r!;
    };

    // ── the pass ────────────────────────────────────────────────────────────────────
    head('the retirement pass');
    const beforeAhead  = await readPost(aheadId);
    const beforeFailed = await readPost(failedId);
    const beforeDone   = await readPost(doneId);

    const retired = await retireExpiredBanked({ db: tx as never, logger }, NOW);
    eq('rows retired', retired, 1);

    // ── 1. the expired post ─────────────────────────────────────────────────────────
    head('1. a banked post whose day has passed → retired, honestly, with no spend');
    const after = await readPost(expiredId);
    eq('status', after.status, 'generation_expired');
    const meta = after.source_meta;
    console.log(`        message: ${String(meta['generationError'])}`);
    eq('quotaBanked cleared', meta['quotaBanked'], undefined);
    eq('quotaBankedAt cleared', meta['quotaBankedAt'], undefined);
    eq('quotaExpiredAt stamped', typeof meta['quotaExpiredAt'], 'string');
    eq('instruction kept', meta['pendingInstruction'], 'our end of summer treat - free uk p&P ending at midnight');
    const msg = String(meta['generationError']);
    eq('the stale promise is gone', /Waiting|1 September/.test(msg), false);
    eq('names the limit', msg.includes('used all your changes'), true);
    eq('names the day that passed', msg.includes('31 August'), true);
    eq('says it was not written', msg.includes('write it'), true);

    // ── 2. the post whose day is ahead ──────────────────────────────────────────────
    head('2. a banked post whose day is still ahead → untouched, still releasable');
    const ahead = await readPost(aheadId);
    eq('status unchanged', ahead.status, 'generation_failed');
    eq('still banked', ahead.source_meta['quotaBanked'], true);
    eq('message unchanged', ahead.source_meta['generationError'], beforeAhead.source_meta['generationError']);
    eq('not written to at all (updated_at)', ahead.updated_at, beforeAhead.updated_at);

    // ── 3. a genuine failure ────────────────────────────────────────────────────────
    head('3. a genuine failure → completely unaffected');
    const failed = await readPost(failedId);
    eq('status unchanged', failed.status, 'generation_failed');
    eq('reason unchanged', failed.source_meta['generationError'], 'the request timed out');
    eq('sweep count unchanged', failed.source_meta['generationSweepAttempts'], 2);
    eq('not written to at all (updated_at)', failed.updated_at, beforeFailed.updated_at);

    // ── 4. idempotence ──────────────────────────────────────────────────────────────
    head('4. idempotence — a second tick rewrites nothing');
    const done = await readPost(doneId);
    eq('already-retired row untouched', done.updated_at, beforeDone.updated_at);
    eq('its stamp is unchanged', done.source_meta['quotaExpiredAt'], '2026-08-11T05:00:00.000Z');

    const afterFirst = await readPost(expiredId);
    const second = await retireExpiredBanked({ db: tx as never, logger }, NOW);
    eq('second pass retires nothing', second, 0);
    const afterSecond = await readPost(expiredId);
    eq('and does not touch the row it just retired', afterSecond.updated_at, afterFirst.updated_at);

    throw new Error('__rollback__');
  }).catch((e: unknown) => {
    if (!(e instanceof Error) || e.message !== '__rollback__') throw e;
    console.log('\n(transaction rolled back — nothing was persisted)');
  });

  console.log(failures === 0 ? '\n\x1b[32mALL CHECKS PASSED\x1b[0m' : `\n\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
