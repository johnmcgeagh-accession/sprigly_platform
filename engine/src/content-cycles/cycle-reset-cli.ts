/**
 * cycle-reset-cli.ts — CLI wrapper for the full cycle reset.
 *
 *   pnpm --filter @sprigly/worker cycle-reset <cycleId>              # DRY RUN (default)
 *   pnpm --filter @sprigly/worker cycle-reset <cycleId> --confirm    # destructive
 *
 * DATABASE_URL and REDIS_URL come from the environment (the package script sources
 * ../.env.local, i.e. UAT). Dry run is the default and --confirm is the only way to write:
 * a destructive tool that does the dangerous thing when you forget a flag is a bad tool.
 *
 * Rationale for what is and is not cleared: docs/reports/cycle-reset-investigation.md.
 */
import { Queue } from 'bullmq';
import { sql } from '@sprigly/db';
import { resetCycle, formatCounts, countState, loadCycle, assertResettable, ResetRefused, type SqlLike, type CycleRef } from './cycle-reset.js';

const QUEUE_NAME = 'content-cycles';

/**
 * Job-id prefixes that embed the cycle id verbatim.
 *
 * All five helpers build `<kind>_<cycleId>[_<suffix>]` (queue.ts:28,128,185,245 and
 * job-options.ts:31), and BullMQ forbids colons in custom job ids so underscore is the
 * separator (job-options.ts:20) — which makes a prefix match exact and safe.
 *
 * ig-trawl and request-email are keyed by (clientId, channel, dataMonth) instead, so they
 * are derived from the cycle row rather than the id.
 */
function cycleJobIdPrefixes(cycle: CycleRef): string[] {
  return [
    `planning_${cycle.id}`,
    `shape_${cycle.id}_`,
    `hook_${cycle.id}_`,
    `script_${cycle.id}_`,
    `weekly_${cycle.id}_`,
    `ig-trawl_${cycle.clientId}_${cycle.channel}_${cycle.cycleMonth}`,
    `request-email_${cycle.clientId}_${cycle.channel}_${cycle.cycleMonth}`,
  ];
}

interface QueueOutcome { found: string[]; removed: string[]; active: string[]; skipped: string | null }

/**
 * Remove this cycle's queued jobs.
 *
 * Removal is not tidiness — it is required for correctness. consumer.ts:168-179 records
 * that "BullMQ silently deduplicates queue.add() against jobs already in the completed
 * set", so a leftover completed `planning_<cycleId>` key makes the NEXT run's enqueue a
 * silent no-op. Retry backoff compounds it: GENERATION_JOB_OPTIONS is attempts:3 with
 * exponential 5s, so an in-flight shape/hook/script job can land on a just-reset cycle
 * seconds later and write into it.
 *
 * The repeatable ticks (scheduler-tick, weekly-session-tick) are GLOBAL, not cycle-keyed,
 * and are deliberately left alone — removing them would stop the scheduler for every client.
 *
 * ACTIVE jobs are never removed: a job mid-execution will finish and write regardless, so
 * silently dropping its key would hide the race rather than fix it. We refuse instead.
 */
async function handleQueue(cycle: CycleRef, confirm: boolean): Promise<QueueOutcome> {
  const url = process.env['REDIS_URL'];
  if (!url) return { found: [], removed: [], active: [], skipped: 'REDIS_URL not set — queue not inspected' };

  const queue = new Queue(QUEUE_NAME, { connection: { url } });
  try {
    const prefixes = cycleJobIdPrefixes(cycle);
    const matches = (id: string | undefined): boolean =>
      !!id && prefixes.some((p) => (p.endsWith('_') ? id.startsWith(p) : id === p));

    const jobs   = await queue.getJobs(['waiting', 'delayed', 'active', 'failed', 'completed', 'paused']);
    const ours   = jobs.filter((j) => matches(j.id));
    const active: string[] = [];
    for (const j of ours) if (await j.isActive()) active.push(j.id!);

    const found = ours.map((j) => j.id!);
    if (!confirm || active.length > 0) return { found, removed: [], active, skipped: null };

    const removed: string[] = [];
    for (const j of ours) { await j.remove(); removed.push(j.id!); }
    return { found, removed, active, skipped: null };
  } finally {
    await queue.close();
  }
}

async function main(): Promise<void> {
  const args    = process.argv.slice(2);
  const cycleId = args.find((a) => !a.startsWith('--'));
  const confirm = args.includes('--confirm');

  if (!cycleId) {
    console.error('usage: cycle-reset <cycleId> [--confirm]   (default: dry run)');
    process.exit(2);
  }
  if (args.includes('--dry-run') && confirm) {
    console.error('refusing: --dry-run and --confirm are contradictory');
    process.exit(2);
  }

  const s = sql as unknown as SqlLike;

  // Guard first, and separately from the reset, so a refusal reports before touching Redis.
  const cycle = await loadCycle(s, cycleId);
  await assertResettable(s, cycle);

  console.log(`cycle   ${cycle.id}`);
  console.log(`client  ${cycle.clientId}${cycle.slug ? ` (${cycle.slug})` : ''}`);
  console.log(`month   ${cycle.cycleMonth}  channel ${cycle.channel}`);
  console.log(`mode    ${confirm ? 'CONFIRM — will delete' : 'DRY RUN — no writes'}\n`);

  const q = await handleQueue(cycle, confirm);
  if (q.skipped) console.log(`queue   ${q.skipped}`);
  else if (q.active.length > 0) {
    console.error(`\nREFUSED: ${q.active.length} ACTIVE job(s) for this cycle: ${q.active.join(', ')}`);
    console.error('An active job will finish and write into the cycle after the reset.');
    console.error('Wait for it to drain (or pause the worker), then re-run. No writes were made.');
    process.exit(1);
  } else {
    console.log(`queue   ${q.found.length} cycle-keyed job(s)${q.found.length ? `: ${q.found.join(', ')}` : ''}`);
    if (confirm) console.log(`queue   removed ${q.removed.length}`);
  }
  console.log();

  if (!confirm) {
    const before = await countState(s, cycleId);
    console.log(formatCounts(before, before));
    console.log('\nDRY RUN — nothing was written. Re-run with --confirm to apply.');
    await sql.end();
    return;
  }

  const result = await resetCycle(s, cycleId, { confirm: true });
  console.log(formatCounts(result.before, result.after));
  console.log('\nreset complete — cycle is back to never-run state.');
  await sql.end();
}

main().catch(async (e) => {
  if (e instanceof ResetRefused) {
    console.error(`\nREFUSED: ${e.message}`);
    console.error('No writes were made.');
  } else {
    console.error(e);
  }
  await sql.end().catch(() => {});
  process.exit(1);
});
