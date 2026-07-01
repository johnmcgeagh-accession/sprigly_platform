/**
 * brief-extract-probe.ts — Phase 1 dry-run for the brief-launch extractor.
 *
 * Runs extractStructuredBrief against ONE real cycle's intake (default: the
 * Ivy T July cycle d502f22d, the Connie brief) and prints the StructuredBrief.
 * READ-ONLY: no audit, no persistence, no Drive, no delivery — only the Bedrock
 * extraction call and a single-column read of the cycle's intake.
 *
 * NOT for committing to the pipeline.
 *
 * Run:
 *   cd engine && set -a && . ../.env.local && set +a && \
 *     tsx src/content-cycles/brief-extract-probe.ts [cycleId]
 */

import pino from 'pino';
import { eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
import type { PlanContentAnswers } from '@sprigly/engine';
import { extractStructuredBrief } from './brief-extract.js';

const DEFAULT_CYCLE = 'd502f22d-983b-442c-880a-db4f86861ecb';
const cycleId = process.argv[2] ?? DEFAULT_CYCLE;

/** "YYYY-MM" → next month "YYYY-MM" (plan month = data month + 1). Inlined so the
 *  probe doesn't pull in planning.ts's Drive/model graph. */
function nextMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const logger = pino({ name: 'brief-extract-probe', level: 'info' });

// Explicit-column read (never select-all — the structured_brief column may not be
// applied, and it is not mapped in the Drizzle schema either).
const rows = await db
  .select({ intakeJson: contentCycles.intakeJson, cycleMonth: contentCycles.cycleMonth })
  .from(contentCycles)
  .where(eq(contentCycles.id, cycleId))
  .limit(1);

const cycle = rows[0];
if (!cycle) {
  console.error(`cycle ${cycleId} not found`);
  process.exit(1);
}

const intake = cycle.intakeJson as { planContent?: PlanContentAnswers } | null;
const planContent: PlanContentAnswers = intake?.planContent ?? { answers: {}, freeNotes: '' };
const planMonth = nextMonth(cycle.cycleMonth);

console.log('');
console.log(`cycle:      ${cycleId}`);
console.log(`data month: ${cycle.cycleMonth}   plan month: ${planMonth}`);
console.log(`answers:    ${Object.keys(planContent.answers ?? {}).length}   freeNotes: ${(planContent.freeNotes ?? '').length} chars`);
console.log('');
console.log('calling extractStructuredBrief (no audit, no persist)...');
console.log('');

const model = createModelClientFromEnv();
const brief = await extractStructuredBrief({ planContent, planMonth, model, logger });

console.log('=== STRUCTURED BRIEF ===');
console.log(JSON.stringify(brief, null, 2));
console.log('');
process.exit(0);
