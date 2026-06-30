/**
 * extract-voice-cycle.ts — manually trigger the voice-merge extract phase.
 *
 * Usage:
 *   pnpm extract-voice-cycle <cycleId>            — dry run (print info, no writes)
 *   pnpm extract-voice-cycle <cycleId> --confirm  — run extract phase
 *
 * The cycle must be in 'active' state. Counterpart to approve-voice-cycle.ts;
 * needed for testing because the finalisation-cutoff trigger is still a stub.
 * --confirm calls extractVoiceDeltasForCycle, which handles the full extract:
 * active → finalised → awaiting_voice_approval, Sonnet call, pending_deltas_json,
 * Drive delta summary, and non-blocking coherence stub.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db, contentCycles, voiceEdits, voiceSnapshots } from '@sprigly/db';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DbPromptResolver } from '@sprigly/prompts';
import { createAuditLogger } from '@sprigly/audit';
import { createModelClientFromEnv } from '@sprigly/model-client';
import pino from 'pino';
import { extractVoiceDeltasForCycle } from './content-cycles/extract.js';

const logger = pino({ level: 'info' });

const rawArgs    = process.argv.slice(2);
const confirm    = rawArgs.includes('--confirm');
const positional = rawArgs.filter((a) => !a.startsWith('--'));
const cycleId    = positional[0];

if (!cycleId) {
  console.error('Usage: extract-voice-cycle <cycleId> [--confirm]');
  process.exit(1);
}

const googleClientId     = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];
if (!googleClientId || !googleClientSecret) {
  console.error('Missing required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
  process.exit(1);
}

const encProvider = createEncryptionProvider();
const audit       = createAuditLogger(db);
const prompts     = new DbPromptResolver(db);
const model       = createModelClientFromEnv();

// Load cycle.
const cycleRows = await db
  .select()
  .from(contentCycles)
  .where(eq(contentCycles.id, cycleId))
  .limit(1);

const cycle = cycleRows[0];
if (!cycle) {
  console.error(`Cycle ${cycleId} not found`);
  process.exit(1);
}

console.log(`\nCycle: ${cycle.clientId} / ${cycle.channel} / ${cycle.cycleMonth}`);
console.log(`Status: ${cycle.status}`);
console.log(`Mode:   ${confirm ? '--confirm (WRITES)' : 'DRY RUN (no writes)'}`);
console.log();

if (cycle.status !== 'active') {
  console.error(`Cannot extract: cycle is '${cycle.status}', expected 'active'`);
  process.exit(1);
}

// Count pending voice_edits for this cycle's month.
const pendingEdits = await db
  .select({ id: voiceEdits.id })
  .from(voiceEdits)
  .where(and(
    eq(voiceEdits.clientId, cycle.clientId),
    eq(voiceEdits.channel,  cycle.channel),
    eq(voiceEdits.month,    cycle.cycleMonth),
    isNull(voiceEdits.ingestedAt),
  ));

// Load current snapshot id for display.
const snapshotRows = await db
  .select({ id: voiceSnapshots.id })
  .from(voiceSnapshots)
  .where(and(
    eq(voiceSnapshots.clientId,  cycle.clientId),
    eq(voiceSnapshots.channel,   cycle.channel),
    eq(voiceSnapshots.isCurrent, true),
  ))
  .limit(1);

const currentSnapshotId = snapshotRows[0]?.id ?? '(none)';

console.log(`Pending voice_edits: ${pendingEdits.length} for ${cycle.cycleMonth}`);
console.log(`Current snapshot:    ${currentSnapshotId}`);
console.log();

if (!confirm) {
  console.log('── DRY RUN. Pass --confirm to extract. ──\n');
  process.exit(0);
}

console.log('Running extract phase...');
await extractVoiceDeltasForCycle(
  cycleId, db, encProvider,
  googleClientId, googleClientSecret,
  model, prompts, audit, logger,
);
console.log('Done. Cycle is now awaiting_voice_approval.\n');
