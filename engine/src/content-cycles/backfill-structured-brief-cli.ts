/**
 * backfill-structured-brief-cli.ts — one-off: populate content_cycles.structured_brief
 * for an existing cycle from its current intake_json, by running the brief extractor.
 *
 * DRY BY DEFAULT: prints the StructuredBrief it WOULD write and writes nothing (a
 * single explicit-column read + one Bedrock call — safe before migration 0058).
 * Pass --write to actually persist (the UPDATE touches structured_brief, so it
 * REQUIRES migration 0058 already applied on the DB).
 *
 * Run (dry):   cd engine && set -a && . ../.env.local && set +a && \
 *                pnpm exec tsx src/content-cycles/backfill-structured-brief-cli.ts <cycleId>
 * Run (write): ... backfill-structured-brief-cli.ts <cycleId> --write
 */

import pino from 'pino';
import { eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
import type { IntakeJson } from '@sprigly/engine';
import { extractStructuredBrief } from './brief-extract.js';

const args = process.argv.slice(2);
const write = args.includes('--write');

// cycleId is REQUIRED and has no fallback. It used to default to a real production cycle
// id, so `--write` with no argument would have persisted a structured_brief onto someone
// else's month. A tool that guesses which cycle it is writing to is how you overwrite one.
const cycleId = args.find((a) => !a.startsWith('--'));
if (!cycleId) {
  console.error('backfill-structured-brief: missing required argument <cycleId>.');
  console.error('usage: pnpm exec tsx src/content-cycles/backfill-structured-brief-cli.ts <cycleId> [--write]');
  process.exit(1);
}

function nextMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const logger = pino({ name: 'backfill-structured-brief', level: 'warn' });

// Explicit-column read — does NOT reference structured_brief, so the DRY path works
// before 0058 is applied.
const [cycle] = await db
  .select({ intakeJson: contentCycles.intakeJson, cycleMonth: contentCycles.cycleMonth, clientId: contentCycles.clientId })
  .from(contentCycles)
  .where(eq(contentCycles.id, cycleId))
  .limit(1);

if (!cycle) { console.error(`cycle ${cycleId} not found`); process.exit(1); }

const intake = cycle.intakeJson as IntakeJson | null;
const planContent = intake?.planContent ?? { answers: {}, freeNotes: '' };
const planMonth = nextMonth(cycle.cycleMonth);

const model = createModelClientFromEnv();
const brief = await extractStructuredBrief({ planContent, planMonth, model, logger });

console.log(`\ncycle ${cycleId} — structured_brief it WOULD write:\n`);
console.log(JSON.stringify(brief, null, 2));

if (!write) {
  console.log('\nDRY RUN — nothing written. Re-run with --write (AFTER migration 0058 is applied) to persist.');
  process.exit(0);
}

await db
  .update(contentCycles)
  .set({ structuredBrief: brief, updatedAt: new Date() })
  .where(eq(contentCycles.id, cycleId));
console.log('\nWROTE structured_brief for', cycleId);
process.exit(0);
