/**
 * approve-voice-cycle.ts — operator approval CLI for the voice-merge gate.
 *
 * Usage:
 *   pnpm approve-voice-cycle <cycleId>            — dry run (print info, no writes)
 *   pnpm approve-voice-cycle <cycleId> --confirm  — run apply phase
 *
 * The cycle must be in 'awaiting_voice_approval' state.
 * Review the Drive delta summary before confirming.
 */

import { eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { createAuditLogger } from '@sprigly/audit';
import pino from 'pino';
import { applyVoiceDeltasForCycle } from './content-cycles/apply.js';
import type { RuleDelta } from './voice-batch-merge.js';

const logger = pino({ level: 'info' });

const rawArgs    = process.argv.slice(2);
const confirm    = rawArgs.includes('--confirm');
const positional = rawArgs.filter((a) => !a.startsWith('--'));
const cycleId    = positional[0];

if (!cycleId) {
  console.error('Usage: approve-voice-cycle <cycleId> [--confirm]');
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

if (cycle.status !== 'awaiting_voice_approval') {
  console.error(`Cannot approve: cycle is '${cycle.status}', expected 'awaiting_voice_approval'`);
  process.exit(1);
}

const deltas = cycle.pendingDeltasJson as unknown as RuleDelta[] | null;
if (!deltas || deltas.length === 0) {
  console.error('No pending_deltas_json on cycle — nothing to apply');
  process.exit(1);
}

const voiceDeltas   = deltas.filter((d) => d.type === 'voice');
const factualDeltas = deltas.filter((d) => d.type === 'factual');

console.log(`Pending deltas: ${deltas.length} total (${voiceDeltas.length} voice, ${factualDeltas.length} factual)`);
console.log();
console.log('Voice deltas:');
voiceDeltas.forEach((d, i) => {
  const target = d.targetSection
    ? ` → ${d.targetSection}${d.targetQuote ? ` / "${d.targetQuote}"` : ''}`
    : '';
  console.log(`  ${i + 1}. [${d.action}]${target}  ${d.rule}`);
});
if (factualDeltas.length > 0) {
  console.log();
  console.log('Factual deltas:');
  factualDeltas.forEach((d, i) => {
    console.log(`  ${i + 1}. ${d.rule}`);
  });
}
console.log();

if (!confirm) {
  console.log('── DRY RUN. Pass --confirm to apply. ──\n');
  process.exit(0);
}

console.log('Applying voice merge...');
await applyVoiceDeltasForCycle(
  cycleId, db, encProvider,
  googleClientId, googleClientSecret,
  audit, logger,
);
console.log('Done.\n');
