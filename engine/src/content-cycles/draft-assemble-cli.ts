/**
 * draft-assemble-cli.ts — assemble a draft plan for one cycle, on demand.
 *
 *   pnpm --filter @sprigly/worker draft-assemble <cycleId>
 *   pnpm --filter @sprigly/worker draft-assemble <cycleId> --auto-approve
 *
 * Why this exists: the ONLY production caller of assembleAndPersistDraft is the Ask-touch
 * closure in consumer.ts, which is gated behind dueTouch (exact day-of-month match), the
 * ask_sent_at at-most-once guard, hasSuppressibleInput and a cohort-month match. Testing
 * the draft arc through the scheduler therefore means waiting for a date or faking one.
 * Calling the function directly bypasses all of that — no date faking, no schedule edit.
 *
 * Bedrock is OPTIONAL here. phraseDraftTitles never throws: it retries once and then
 * returns outcome:'fallback', leaving the deterministic assembler titles in place. So a
 * run without model access still assembles and persists — you just get `phrasing:
 * "fallback"` in the output, which for a structural test is the more reproducible mode.
 *
 * --auto-approve runs the full D3 cutoff path via autoApproveAndGenerate: the approval
 * core with auto=true (skips the pre-cutoff guard, stamps approved_by='auto'), then the
 * generation fan-out — a shape job per approved beat and a hook job for every reel or
 * carousel. That SPENDS BEDROCK BUDGET once the worker picks the jobs up, and it needs a
 * reachable REDIS_URL.
 *
 * Note it does NOT send plan_ready_auto: that email lives in sendAppReadyNotification,
 * which is reached from the delivery path rather than from approval.
 *
 * SAFETY: refuses unless the cycle's client has draft_flow_enabled, the same posture as
 * cycle-reset. There is no default cycle id and no fallback of any kind — a tool that
 * guesses which cycle it is writing to is how you rewrite a real client's month.
 */
import pino from 'pino';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, sql, contentCycles } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createAuditLogger } from '@sprigly/audit';
import { DbPromptResolver } from '@sprigly/prompts';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { env } from '../env.js';
import { assembleAndPersistDraft, draftFlowEnabled, autoApproveAndGenerate, type AssembleAndPersistResult } from './draft-plan.js';

const args    = process.argv.slice(2);
const cycleId = args.find((a) => !a.startsWith('--'));
const autoApprove = args.includes('--auto-approve');

if (!cycleId) {
  console.error('draft-assemble: missing required argument <cycleId>.');
  console.error('usage: pnpm --filter @sprigly/worker draft-assemble <cycleId> [--auto-approve]');
  process.exit(1);
}

/** Status chatter goes to stderr so stdout carries the result JSON and nothing else. */
const logger = pino({ name: 'draft-assemble', level: 'warn' }, pino.destination(2));

async function fail(message: string): Promise<never> {
  console.error(`\ndraft-assemble: ${message}`);
  await sql.end().catch(() => {});
  process.exit(1);
}

const [cycle] = await db
  .select({ id: contentCycles.id, clientId: contentCycles.clientId, cycleMonth: contentCycles.cycleMonth })
  .from(contentCycles)
  .where(eq(contentCycles.id, cycleId))
  .limit(1);

if (!cycle) await fail(`no content_cycles row with id ${cycleId}`);

// Same shape the consumer builds for the Ask touch (consumer.ts:213).
const deps = {
  db,
  encProvider:        createEncryptionProvider(),
  googleClientId:     env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  model:              createModelClientFromEnv(),
  prompts:            new DbPromptResolver(db),
  audit:              createAuditLogger(db),
  logger,
};

if (!(await draftFlowEnabled(deps, cycle!.clientId))) {
  await fail(
    `client ${cycle!.clientId} does not have draft_flow_enabled — ` +
    'this tool only assembles drafts for sandbox clients running the draft flow',
  );
}

// A cycle past planning is refused by assertCycleAssemblable (draft-plan.ts): assembling into
// it would write draft rows the surface renders uneditable. Surface that refusal as a clean
// operator message rather than a stack trace — it names the status and the reset command.
const result: AssembleAndPersistResult = await assembleAndPersistDraft({ clientId: cycle!.clientId, cycleId }, deps)
  .catch(async (err): Promise<never> => {
    await fail(err instanceof Error ? err.message : String(err));   // exits the process
    throw err;                                                       // unreachable; satisfies never
  });

let approval: { approved: number; captionsQueued: number; capped: boolean } | undefined;
if (autoApprove) {
  const queue = new Queue('content-cycles', { connection: { url: env.REDIS_URL } });
  try {
    approval = await autoApproveAndGenerate(deps, queue, cycle!.clientId, cycleId);
  } finally {
    await queue.close();
  }
}

console.log(JSON.stringify(autoApprove ? { ...result, approval } : result, null, 2));

await sql.end();
process.exit(0);
