/**
 * drive-poller.ts — poll Drive changes feeds for all active client channels.
 *
 * Lives in the worker (not @sprigly/sources) because it holds a BullMQ Queue
 * reference and enqueues calendar:detect-edits directly. GmailPoller can live
 * in @sprigly/sources because it writes incomingEvents rows and the worker's
 * pollAllClients handles the enqueueing. Drive has no incomingEvents row.
 *
 * Watermark model (mirrors GmailPoller's last_polled_at discipline):
 *   - drive_page_token stored per client_channel (not per oauth_connection)
 *     because the Drive changes feed is per-account but routing is per-folder,
 *     and each channel can have a different folder with a different watermark.
 *   - Null token = never polled: call getStartPageToken, persist, return 0.
 *     No backlog is processed on first activation.
 *   - Watermark advances to changesList's nextPageToken ONLY after the cycle
 *     completes without throwing. Error mid-cycle → token unadvanced → retry.
 *
 * Idempotency key: `${fileId}:${modifiedTime}` stored in processed_external_ids
 *   - fileId alone would suppress a SECOND client edit to the same file (same
 *     fileId, different modifiedTime). The composite key distinguishes edits.
 *   - modifiedTime is Drive's own authoritative modification timestamp (ISO 8601,
 *     millisecond precision). No extra API call: comes from getFileMeta().
 *
 * Folder filter:
 *   - changesList returns ALL Drive changes for the authenticated account, not
 *     just changes in this channel's folder. A client with multiple channels
 *     (instagram, linkedin, …) creates files in multiple folders; each channel's
 *     poll must only act on its own folder. Filter via file.parents.
 */

import {
  db as _db,
  clientChannels,
  oauthConnections,
  processedExternalIds,
} from '@sprigly/db';
import { eq, and, isNotNull } from 'drizzle-orm';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { Queue } from 'bullmq';
import type { Logger } from 'pino';

type Db = typeof _db;

type ChannelRow = {
  id: string;
  clientId: string;
  channel: string;
  driveFolderId: string | null;
  drivePageToken: string | null;
};

export class DrivePoller {
  constructor(
    private db: Db,
    private encProvider: EncryptionProvider,
    private googleClientId: string,
    private googleClientSecret: string,
    private queue: Queue,
    private logger: Logger,
  ) {}

  /** Poll all active channels that have a drive_folder_id and whose client
   *  has an active Drive oauth_connection. Called on every cron tick. */
  async pollAllChannels(): Promise<void> {
    const channels = await this.db
      .select({
        id:             clientChannels.id,
        clientId:       clientChannels.clientId,
        channel:        clientChannels.channel,
        driveFolderId:  clientChannels.driveFolderId,
        drivePageToken: clientChannels.drivePageToken,
      })
      .from(clientChannels)
      .where(
        and(
          eq(clientChannels.status, 'active'),
          isNotNull(clientChannels.driveFolderId),
        ),
      );

    const activeDriverClients = new Set(
      (await this.db
        .select({ clientId: oauthConnections.clientId })
        .from(oauthConnections)
        .where(
          and(
            eq(oauthConnections.provider, 'drive'),
            eq(oauthConnections.status, 'active'),
          ),
        )
      ).map((r) => r.clientId),
    );

    for (const row of channels) {
      if (!activeDriverClients.has(row.clientId)) continue;
      try {
        const count = await this.pollChannel(row);
        if (count > 0) {
          this.logger.info(
            { clientId: row.clientId, channel: row.channel, count },
            'drive: enqueued calendar:detect-edits jobs',
          );
        }
      } catch (err) {
        this.logger.error(
          { clientId: row.clientId, channel: row.channel, err: String(err) },
          'drive: poll failed',
        );
      }
    }
  }

  /** Poll one channel. Returns the number of calendar:detect-edits jobs enqueued.
   *  Exported for use in the Gate 3 test script. */
  async pollChannel(channel: ChannelRow): Promise<number> {
    const { clientId, channel: channelName, driveFolderId, drivePageToken: storedToken } = channel;
    if (!driveFolderId) return 0;

    const tokens = await getTokens(this.db, this.encProvider, clientId, 'drive');
    if (!tokens) return 0;

    const drive = new DriveApiClient(
      this.googleClientId,
      this.googleClientSecret,
      tokens,
      (refreshed) => storeTokens(this.db, this.encProvider, clientId, 'drive', refreshed),
    );

    // ── Null watermark: first activation ─────────────────────────────────────
    // Initialise token to the current head of the changes feed and return.
    // No historical changes are processed — we only want changes from now on.
    if (storedToken === null) {
      const initToken = await drive.getStartPageToken();
      await this.db
        .update(clientChannels)
        .set({ drivePageToken: initToken, updatedAt: new Date() })
        .where(eq(clientChannels.id, channel.id));
      this.logger.info(
        { clientId, channel: channelName },
        'drive: watermark initialised — backlog skipped',
      );
      return 0;
    }

    // ── Poll changes since the stored watermark ───────────────────────────────
    // changesList pages through ALL changes until exhausted, returning the new
    // head token as nextPageToken. The token advances only after the cycle
    // succeeds — if anything throws below, the watermark stays at storedToken.
    const { changes, nextPageToken } = await drive.changesList(storedToken);

    let count = 0;

    for (const change of changes) {
      // Skip deletions/trashes — only live content changes trigger workflows.
      if (change.removed) continue;

      // Fetch metadata to get modifiedTime (for the idempotency key) and
      // parents (for the folder filter). A try-catch handles the race where
      // the file was deleted between changesList and now.
      let meta: Awaited<ReturnType<typeof drive.getFileMeta>>;
      try {
        meta = await drive.getFileMeta(change.fileId);
      } catch {
        this.logger.warn(
          { clientId, channel: channelName, fileId: change.fileId },
          'drive: getFileMeta failed — file may have been deleted, skipping',
        );
        continue;
      }

      // Folder filter: changesList returns changes for the entire account.
      // Only act on files whose parent is this channel's configured folder.
      if (!meta.parents?.includes(driveFolderId)) continue;

      // Idempotency key: `${fileId}:${modifiedTime}`.
      // A bare fileId would suppress a second client edit to the same file.
      // modifiedTime (Drive's own timestamp, ms precision) changes on every save,
      // so two distinct edits produce two distinct keys and two enqueued jobs.
      const externalId = `${change.fileId}:${meta.modifiedTime}`;

      const existing = await this.db
        .select({ id: processedExternalIds.id })
        .from(processedExternalIds)
        .where(
          and(
            eq(processedExternalIds.clientId, clientId),
            eq(processedExternalIds.source, 'drive'),
            eq(processedExternalIds.externalId, externalId),
          ),
        )
        .limit(1);

      if (existing[0] !== undefined) continue;

      const lname = meta.name.toLowerCase();
      const isXlsx =
        lname.endsWith('.xlsx') ||
        meta.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const isCsv = lname.endsWith('.csv') || meta.mimeType === 'text/csv';

      if (isXlsx) {
        // Enqueue with a deterministic jobId so duplicate enqueue attempts are
        // idempotent at the BullMQ level too (Belt-and-suspenders on top of
        // the processedExternalIds check).
        await this.queue.add(
          'calendar:detect-edits',
          { clientId, channel: channelName, fileId: change.fileId },
          { jobId: `detect-edits:${externalId}` },
        );

        await this.db.insert(processedExternalIds).values({
          clientId,
          source:      'drive',
          externalId,
          processedAt: new Date(),
        });

        count++;
        this.logger.info(
          { clientId, channel: channelName, fileId: change.fileId, name: meta.name },
          'drive: xlsx change detected — enqueued calendar:detect-edits',
        );
      } else if (isCsv) {
        // TODO(stage-4): CSV is the raw calendar schedule; wire build-workbook hook here.
        this.logger.info(
          { clientId, channel: channelName, fileId: change.fileId, name: meta.name },
          'drive: CSV change detected — Stage 4 hook not yet wired',
        );
      }
    }

    // ── Advance watermark ─────────────────────────────────────────────────────
    // Only reached if the loop completed without throwing. If an error propagated
    // out of pollChannel, the caller's try-catch catches it and this update never
    // runs, leaving storedToken unchanged for the next cycle's retry.
    await this.db
      .update(clientChannels)
      .set({ drivePageToken: nextPageToken, updatedAt: new Date() })
      .where(eq(clientChannels.id, channel.id));

    return count;
  }
}
