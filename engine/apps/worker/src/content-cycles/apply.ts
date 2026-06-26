/**
 * apply.ts — voice-merge gate: apply phase.
 *
 * Called by the approval CLI (approve-voice-cycle) or the content-cycles
 * BullMQ consumer after operator approval. Reads pending_deltas_json from the
 * cycle row, applies them to the current voice snapshot, and advances to closed.
 *
 * "closed" means voice edits have been applied to the profile.
 * It does NOT mean coherence contradictions are resolved — the Drive coherence
 * report (when implemented) is the resolution signal, not cycle state.
 *
 * Transitions: awaiting_voice_approval → voice_merged → closed
 * On error:    → failed, failed_step='voice-apply' (edits stay pending, voice.md untouched)
 */

import { eq, and, isNull, inArray, asc } from 'drizzle-orm';
import {
  db as _db,
  contentCycles,
  voiceEdits,
  voiceIngestionRuns,
  voiceSnapshots,
  clientChannels,
} from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { AuditLogger } from '@sprigly/audit';
import type { Logger } from 'pino';
import { transitionCycle } from './machine.js';
import {
  applyVoiceDeltas,
  routeFactualDeltasToDrive,
} from '../voice-batch-merge.js';
import type { RuleDelta } from '../voice-batch-merge.js';
import {
  validateMergedBlock,
  updateVoiceMdOnDrive,
} from '../voice-consumer.js';

type Db = typeof _db;

export async function applyVoiceDeltasForCycle(
  cycleId:            string,
  db:                 Db,
  encProvider:        EncryptionProvider,
  googleClientId:     string,
  googleClientSecret: string,
  audit:              AuditLogger,
  logger:             Logger,
): Promise<void> {
  const rows = await db
    .select()
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  const cycle = rows[0];
  if (!cycle) throw new Error(`applyVoiceDeltasForCycle: cycle ${cycleId} not found`);

  const { clientId, channel, cycleMonth, pendingDeltasJson } = cycle;
  const logCtx = { cycleId, clientId, channel, cycleMonth };

  if (cycle.status !== 'awaiting_voice_approval') {
    throw new Error(
      `applyVoiceDeltasForCycle: cycle is '${cycle.status}', expected 'awaiting_voice_approval'`,
    );
  }
  if (!pendingDeltasJson) {
    throw new Error(`applyVoiceDeltasForCycle: no pending_deltas_json on cycle ${cycleId}`);
  }

  const allDeltas     = pendingDeltasJson as unknown as RuleDelta[];
  const voiceDeltas   = allDeltas.filter((d) => d.type === 'voice');
  const factualDeltas = allDeltas.filter((d) => d.type === 'factual');
  const channelTitle  = channel.charAt(0).toUpperCase() + channel.slice(1);

  try {
    // Load current snapshot (may have changed since extract — always re-read).
    const snapshotRows = await db
      .select()
      .from(voiceSnapshots)
      .where(and(
        eq(voiceSnapshots.clientId,  clientId),
        eq(voiceSnapshots.channel,   channel),
        eq(voiceSnapshots.isCurrent, true),
      ))
      .limit(1);

    const currentSnapshot = snapshotRows[0];
    const baseBlock       = currentSnapshot?.snapshotMd ?? `## ${channelTitle} — Voice Profile\n`;

    // Find pending edits to mark consumed in the transaction.
    const edits   = await db
      .select({ id: voiceEdits.id })
      .from(voiceEdits)
      .where(and(
        eq(voiceEdits.clientId, clientId),
        eq(voiceEdits.channel,  channel),
        eq(voiceEdits.month,    cycleMonth),
        isNull(voiceEdits.ingestedAt),
      ));
    const batchIds  = edits.map((e) => e.id);
    const startedAt = new Date();

    // Apply deltas and validate.
    const newChannelBlock = applyVoiceDeltas(baseBlock, voiceDeltas, cycleMonth, logger, { clientId, channel });
    validateMergedBlock(newChannelBlock, channelTitle);

    // Atomic transaction: FK order same as mergeChannelEdits.
    let newSnapshotId: string | undefined;
    await db.transaction(async (tx) => {
      if (currentSnapshot) {
        await tx
          .update(voiceSnapshots)
          .set({ isCurrent: false, updatedAt: new Date() })
          .where(eq(voiceSnapshots.id, currentSnapshot.id));
      }

      const [runRow] = await tx
        .insert(voiceIngestionRuns)
        .values({
          clientId,
          channel,
          month:     cycleMonth,
          status:    'running',
          editCount: batchIds.length,
          startedAt,
        })
        .returning({ id: voiceIngestionRuns.id });

      if (!runRow) throw new Error('Failed to insert voice_ingestion_runs row');
      const runId = runRow.id;

      const [newSnapshotRow] = await tx
        .insert(voiceSnapshots)
        .values({
          clientId,
          channel,
          snapshotMd:  newChannelBlock,
          reason:      'monthly-ingest',
          sourceMonth: cycleMonth,
          runId,
          isCurrent:   true,
        })
        .returning({ id: voiceSnapshots.id });

      if (!newSnapshotRow) throw new Error('Failed to insert voice_snapshots row');
      newSnapshotId = newSnapshotRow.id;

      await tx
        .update(voiceIngestionRuns)
        .set({ status: 'applied', snapshotId: newSnapshotId, endedAt: new Date(), updatedAt: new Date() })
        .where(eq(voiceIngestionRuns.id, runId));

      if (batchIds.length > 0) {
        await tx
          .update(voiceEdits)
          .set({ ingestedAt: new Date(), ingestionRunId: runId, updatedAt: new Date() })
          .where(inArray(voiceEdits.id, batchIds));
      }
    });

    logger.info({ ...logCtx, newSnapshotId }, 'content-cycles: apply phase snapshot committed');

    // awaiting_voice_approval → voice_merged
    await transitionCycle(db, cycleId, 'voice_merged', { voiceMergedAt: new Date() }, logger);

    // Drive updates (both non-fatal — snapshot is already committed).
    const tokens = await getTokens(db, encProvider, clientId, 'drive');
    if (!tokens) {
      logger.warn({ ...logCtx }, 'content-cycles: no Drive tokens — voice.md and client-facts.md not updated');
    } else {
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

      const allChannelRows = await db
        .select({ driveFolderId: clientChannels.driveFolderId })
        .from(clientChannels)
        .where(eq(clientChannels.clientId, clientId))
        .orderBy(asc(clientChannels.channel));
      const clientFolderDriveId = allChannelRows[0]?.driveFolderId ?? driveFolderId;

      if (driveFolderId) {
        try {
          await updateVoiceMdOnDrive(db, drive, clientId, driveFolderId, channelTitle, newChannelBlock, logger);
          logger.info({ ...logCtx }, 'content-cycles: voice.md updated in Drive');
        } catch (err) {
          logger.error(
            { ...logCtx, err: String(err) },
            'content-cycles: voice.md Drive update failed — snapshot committed, Drive file may be stale',
          );
        }
      }

      if (factualDeltas.length > 0 && clientFolderDriveId) {
        try {
          await routeFactualDeltasToDrive(
            drive, clientFolderDriveId, channelTitle, factualDeltas, cycleMonth, logger, { clientId, channel },
          );
        } catch (err) {
          logger.warn(
            { ...logCtx, err: String(err) },
            'content-cycles: client-facts.md update failed — non-fatal',
          );
        }
      }
    }

    // "closed" = voice edits applied to profile.
    // Does NOT mean coherence contradictions resolved — Drive coherence report is the resolution signal.
    await transitionCycle(db, cycleId, 'closed', { closedAt: new Date() }, logger);

    void audit; // audit param reserved for future per-cycle audit rows

  } catch (err) {
    logger.error({ ...logCtx, err: String(err) }, 'content-cycles: apply phase failed');
    await transitionCycle(db, cycleId, 'failed', { failedStep: 'voice-apply' }, logger)
      .catch((te) => {
        logger.error({ ...logCtx, err: String(te) }, 'content-cycles: failed to transition to failed state');
      });
    throw err;
  }
}
