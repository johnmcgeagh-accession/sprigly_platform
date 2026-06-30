/**
 * extract.ts — voice-merge gate: extract phase.
 *
 * Called on active → finalised (triggered by the finalisation-cutoff stub).
 * Produces RuleDelta[] and stores them on the cycle row. Does NOT apply deltas
 * or touch voice.md. Operator reviews the delta summary written to Drive, then
 * approves via approve-voice-cycle CLI (which calls apply.ts).
 *
 * Transitions: active → finalised → awaiting_voice_approval
 * On error:    → failed, failed_step='voice-extract'
 */

import { eq, and, isNull } from 'drizzle-orm';
import {
  db as _db,
  contentCycles,
  voiceEdits,
  voiceSnapshots,
  clientChannels,
} from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { DbPromptResolver } from '@sprigly/prompts';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { Logger } from 'pino';
import { transitionCycle } from './machine.js';
import { coherenceDetectorStub } from './stubs.js';
import { extractDeltasFromEdits } from '../voice-batch-merge.js';
import type { RuleDelta } from '../voice-batch-merge.js';

type Db = typeof _db;

function buildDeltaSummary(
  channelTitle: string,
  cycleMonth:   string,
  editCount:    number,
  allDeltas:    RuleDelta[],
): string {
  const voiceDeltas   = allDeltas.filter((d) => d.type === 'voice');
  const factualDeltas = allDeltas.filter((d) => d.type === 'factual');

  const lines: string[] = [
    `# Voice Delta Summary — ${channelTitle} — ${cycleMonth}`,
    '',
    `**Extracted:** ${new Date().toISOString()}`,
    `**Edits processed:** ${editCount}`,
    `**Total deltas:** ${allDeltas.length} (${voiceDeltas.length} voice, ${factualDeltas.length} factual)`,
    '',
    '---',
    '',
    '## Voice Deltas',
    '',
  ];

  if (voiceDeltas.length === 0) {
    lines.push('*(none)*', '');
  } else {
    voiceDeltas.forEach((d, i) => {
      lines.push(`### ${i + 1}. [${d.action}] ${d.rule}`);
      if (d.targetSection) {
        lines.push(`- **Section:** ${d.targetSection}`);
        if (d.targetQuote) lines.push(`- **Quote:** "${d.targetQuote}"`);
      }
      lines.push(
        `- **Evidence:** "${d.evidence.before}" → "${d.evidence.after}"`,
        '',
      );
    });
  }

  lines.push('## Factual Deltas', '');

  if (factualDeltas.length === 0) {
    lines.push('*(none)*', '');
  } else {
    factualDeltas.forEach((d, i) => {
      lines.push(
        `### ${i + 1}. ${d.rule}`,
        `- **Evidence:** "${d.evidence.before}" → "${d.evidence.after}"`,
        '',
      );
    });
  }

  lines.push(
    '---',
    '',
    '_Approve via `pnpm approve-voice-cycle <cycleId> --confirm`._',
  );

  return lines.join('\n');
}

export async function extractVoiceDeltasForCycle(
  cycleId:           string,
  db:                Db,
  encProvider:       EncryptionProvider,
  googleClientId:    string,
  googleClientSecret: string,
  model:             ModelClient,
  prompts:           DbPromptResolver,
  audit:             AuditLogger,
  logger:            Logger,
): Promise<void> {
  const rows = await db
    .select()
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  const cycle = rows[0];
  if (!cycle) throw new Error(`extractVoiceDeltasForCycle: cycle ${cycleId} not found`);

  const { clientId, channel, cycleMonth } = cycle;
  const logCtx = { cycleId, clientId, channel, cycleMonth };

  // active → finalised
  await transitionCycle(db, cycleId, 'finalised', { finalisedAt: new Date() }, logger);

  try {
    // Claim pending edits for this cycle's month.
    const edits = await db
      .select()
      .from(voiceEdits)
      .where(and(
        eq(voiceEdits.clientId, clientId),
        eq(voiceEdits.channel,  channel),
        eq(voiceEdits.month,    cycleMonth),
        isNull(voiceEdits.ingestedAt),
      ));

    if (edits.length === 0) {
      logger.info({ ...logCtx }, 'content-cycles: no pending edits for cycle — nothing to extract');
      await transitionCycle(db, cycleId, 'awaiting_voice_approval', {}, logger);
      return;
    }

    // Load current snapshot.
    const snapshotRows = await db
      .select()
      .from(voiceSnapshots)
      .where(and(
        eq(voiceSnapshots.clientId,  clientId),
        eq(voiceSnapshots.channel,   channel),
        eq(voiceSnapshots.isCurrent, true),
      ))
      .limit(1);

    const currentVoiceProfile = snapshotRows[0]?.snapshotMd
      ?? '(none — this is the first voice profile for this channel)';

    const channelTitle   = channel.charAt(0).toUpperCase() + channel.slice(1);
    const promptTemplate = await prompts.resolve(clientId, 'voice-ingest', 'merge');

    logger.info({ ...logCtx, editCount: edits.length }, 'content-cycles: calling Sonnet for delta extraction');

    const allDeltas = await extractDeltasFromEdits(
      edits, channelTitle, currentVoiceProfile, promptTemplate,
      model, audit, clientId, cycleMonth, { clientId, channel }, logger,
    );

    logger.info(
      {
        ...logCtx,
        deltaCount:        allDeltas.length,
        voiceDeltaCount:   allDeltas.filter((d) => d.type === 'voice').length,
        factualDeltaCount: allDeltas.filter((d) => d.type === 'factual').length,
      },
      'content-cycles: deltas extracted',
    );

    // Store deltas on the cycle (gate buffer).
    await db
      .update(contentCycles)
      .set({ pendingDeltasJson: allDeltas as unknown, updatedAt: new Date() })
      .where(eq(contentCycles.id, cycleId));

    // Call coherence detector (non-blocking — stub throws NOT_IMPLEMENTED).
    try {
      await coherenceDetectorStub(
        currentVoiceProfile,
        allDeltas.filter((d) => d.type === 'voice'),
        clientId,
        channel,
      );
    } catch (err) {
      if (String(err).includes('NOT_IMPLEMENTED')) {
        logger.warn({ ...logCtx }, 'content-cycles: coherence detector not yet implemented — skipping');
      } else {
        logger.error({ ...logCtx, err: String(err) }, 'content-cycles: coherence detector error — non-fatal');
      }
    }

    // Write delta summary to Drive for operator review.
    try {
      const tokens = await getTokens(db, encProvider, clientId, 'drive');
      if (tokens) {
        const drive = new DriveApiClient(
          googleClientId, googleClientSecret, tokens,
          (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
        );

        const channelRows = await db
          .select({ driveFolderId: clientChannels.driveFolderId })
          .from(clientChannels)
          .where(and(
            eq(clientChannels.clientId, clientId),
            eq(clientChannels.channel,  channel),
          ))
          .limit(1);

        const driveFolderId = channelRows[0]?.driveFolderId;
        if (driveFolderId) {
          const summaryMd  = buildDeltaSummary(channelTitle, cycleMonth, edits.length, allDeltas);
          const content    = Buffer.from(summaryMd, 'utf-8');
          const fileName   = `voice-delta-summary-${cycleMonth}.md`;
          const files      = await drive.listFiles(driveFolderId);
          const existingFile = files.find((f) => f.name === fileName);

          if (existingFile) {
            await drive.updateFile(existingFile.id, 'text/plain; charset=utf-8', content);
          } else {
            await drive.createFile(driveFolderId, fileName, 'text/plain; charset=utf-8', content);
          }

          logger.info({ ...logCtx, fileName }, 'content-cycles: delta summary written to Drive');
        }
      } else {
        logger.warn({ ...logCtx }, 'content-cycles: no Drive tokens — delta summary not written');
      }
    } catch (driveErr) {
      logger.warn(
        { ...logCtx, err: String(driveErr) },
        'content-cycles: delta summary Drive write failed — non-fatal',
      );
    }

    // finalised → awaiting_voice_approval
    await transitionCycle(db, cycleId, 'awaiting_voice_approval', {}, logger);

  } catch (err) {
    logger.error({ ...logCtx, err: String(err) }, 'content-cycles: extract phase failed');
    await transitionCycle(db, cycleId, 'failed', { failedStep: 'voice-extract' }, logger)
      .catch((te) => {
        logger.error({ ...logCtx, err: String(te) }, 'content-cycles: failed to transition to failed state');
      });
    throw err;
  }
}
