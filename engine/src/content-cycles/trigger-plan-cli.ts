/**
 * trigger-plan-cli.ts — CLI for on-demand cycle creation + planning enqueue.
 *
 * Creates a content_cycles row at status='intake_confirmed' for a chosen PLAN month
 * and enqueues the planning job, bypassing the scheduler's ig-trawl/email chain.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker trigger-plan <client-slug> <channel> --plan-month YYYY-MM [--intake "..."]
 *   e.g. pnpm --filter @sprigly/worker trigger-plan ivy-t instagram --plan-month 2026-08 --intake "Launching the Wren vest on the 12th"
 *
 * --plan-month is the month the plan is FOR; cycle_month = plan-month − 1 (echoed).
 * Enqueues a { type:'planning', cycleId } job on the 'content-cycles' queue — the
 * SAME job the admin enqueuePlanning path produces (that helper is server-only and
 * not importable here, so we mirror it with the engine's own job-options).
 */

import pino from 'pino';
import { Queue } from 'bullmq';
import { db } from '@sprigly/db';
import { env } from '../env.js';
import { createOnDemandCycle } from './trigger-plan.js';
import { PLANNING_JOB_OPTIONS, planningJobId } from './job-options.js';

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const argv      = process.argv.slice(2);
const clientSlug = argv[0];
const channel    = argv[1];
const planMonth  = getFlag(argv, '--plan-month');
const intake     = getFlag(argv, '--intake');

if (!clientSlug || clientSlug.startsWith('--') || !channel || channel.startsWith('--') || !planMonth) {
  console.error('Usage: pnpm --filter @sprigly/worker trigger-plan <client-slug> <channel> --plan-month YYYY-MM [--intake "..."]');
  console.error('  e.g. pnpm --filter @sprigly/worker trigger-plan ivy-t instagram --plan-month 2026-08');
  process.exit(1);
}

const logger = pino({ name: 'trigger-plan', level: 'info' });

// Real BullMQ enqueue — mirrors admin enqueuePlanning: clear a stale completed/failed
// job under the deterministic jobId so a re-run lands; refuse only if one is active.
async function enqueuePlanningJob(cycleId: string): Promise<void> {
  const queue = new Queue('content-cycles', { connection: { url: env.REDIS_URL } });
  try {
    const jobId = planningJobId(cycleId);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        throw new Error(`a planning job is already ${state} for cycle ${cycleId} — not re-enqueuing`);
      }
      if (state === 'completed' || state === 'failed' || state === 'unknown') {
        try { await existing.remove(); } catch { /* best-effort */ }
      }
    }
    await queue.add('planning', { type: 'planning', cycleId }, { ...PLANNING_JOB_OPTIONS, jobId });
    logger.info({ cycleId, jobId }, 'trigger-plan: enqueued planning job');
  } finally {
    await queue.close();
  }
}

const result = await createOnDemandCycle({ db, clientSlug, channel, planMonth, intake, enqueue: enqueuePlanningJob, logger });

console.log(`plan for ${result.planMonth} → cycle_month ${result.cycleMonth}`);
if (result.ok) {
  console.log(`✓ ${result.message}`);
  process.exit(0);
} else {
  console.error(`✗ ${result.message}`);
  process.exit(1);
}
