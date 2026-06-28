/**
 * drive-poller.ts — poll Drive changes feeds for all active client channels.
 *
 * Lives in the worker (not @sprigly/sources) because it holds BullMQ Queue
 * references and enqueues jobs directly. GmailPoller can live in @sprigly/sources
 * because it writes incomingEvents rows and the worker's pollAllClients handles
 * the enqueueing. Drive has no incomingEvents row for xlsx — it enqueues directly
 * to calendar-events. For CSV files it creates an incomingEvents row and enqueues
 * to incoming-events so the normal workflow consumer handles it.
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
  contentCycles,
  incomingEvents,
  oauthConnections,
  processedExternalIds,
} from '@sprigly/db';
import { eq, and, isNotNull } from 'drizzle-orm';
import { transitionCycle } from './content-cycles/machine.js';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { Queue } from 'bullmq';
import type { Logger } from 'pino';

type Db = typeof _db;

// Parse "Month Year" from workbook filename → "YYYY-MM".
// Filename format: "{name} — Content calendar - {Month} {Year}.xlsx"
// Returns null if the filename does not match — never guesses.
const WORKBOOK_MONTH_RE = / - ([A-Za-z]+) (\d{4})\.xlsx$/;
const MONTH_NAME_TO_NUM: Readonly<Record<string, string>> = {
  January: '01', February: '02', March: '03',  April:    '04',
  May:     '05', June:     '06', July:  '07',  August:   '08',
  September: '09', October: '10', November: '11', December: '12',
};

function parseWorkbookMonth(filename: string): string | null {
  const match = WORKBOOK_MONTH_RE.exec(filename);
  if (!match) return null;
  const monthNum = MONTH_NAME_TO_NUM[match[1] ?? ''];
  if (!monthNum) return null;
  return `${match[2]}-${monthNum}`;
}

// "YYYY-MM" → previous month's "YYYY-MM" (rolls the year at January).
// A workbook is named for the PLAN month; the owning cycle's cycle_month is the
// DATA month, one earlier (planning targets cycle_month + 1).
export function prevMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y!, (m! - 2), 1)); // m is 1-based; m-2 == previous month index
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

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
    private calendarQueue: Queue,   // calendar-events: xlsx detect-edits jobs
    private incomingQueue: Queue,   // incoming-events: CSV build-workbook jobs
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

  /** Poll one channel. Returns the number of calendar:detect-edits jobs enqueued
   *  (xlsx edits only; CSV build-workbook jobs are logged separately). */
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
    const { changes, nextPageToken } = await drive.changesList(storedToken);

    let count = 0;

    for (const change of changes) {
      if (change.removed) continue;

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
      // Only match the canonical workbook name written by build-workbook:
      // "{client} — Content calendar - {Month} {Year}.xlsx"
      // Other xlsx files in the folder (e.g. gate3 test files) are ignored.
      const WORKBOOK_RE = /^.+ — Content calendar - [A-Za-z]+ \d{4}\.xlsx$/;
      const isWorkbook = WORKBOOK_RE.test(meta.name);
      const isCsv = lname.endsWith('.csv') || meta.mimeType === 'text/csv';

      if (isWorkbook) {
        // Self-write suppression via ledger:
        // build-workbook records fileId:modifiedTime into processed_external_ids with
        // source='drive-self-write' at write time. The poller checks that ledger here.
        // This is change-bound (tied to the exact modifiedTime build-workbook produced),
        // unlike checking lastModifyingUser.me which reads current file state and is racy.
        // A later client edit produces a new modifiedTime → new externalId → NOT in ledger.
        const selfWriteRow = await this.db
          .select({ id: processedExternalIds.id })
          .from(processedExternalIds)
          .where(
            and(
              eq(processedExternalIds.clientId, clientId),
              eq(processedExternalIds.source, 'drive-self-write'),
              eq(processedExternalIds.externalId, externalId),
            ),
          )
          .limit(1);

        if (selfWriteRow[0] !== undefined) {
          await this.db.insert(processedExternalIds).values({
            clientId,
            source:      'drive',
            externalId,
            processedAt: new Date(),
          });
          this.logger.info(
            { clientId, channel: channelName, fileId: change.fileId, name: meta.name },
            'drive: xlsx self-write suppressed — build-workbook ledger match',
          );
          continue;
        }

        // Not in self-write ledger → genuine client edit: enqueue detect-edits.
        // BullMQ forbids colons in custom jobIds (Redis namespace separator).
        // Encode them as underscores for the jobId; the DB externalId is unchanged.
        await this.calendarQueue.add(
          'calendar:detect-edits',
          { clientId, channel: channelName, fileId: change.fileId, driveFolderId },
          { jobId: `detect-edits_${externalId.replace(/:/g, '_')}` },
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
          'drive: xlsx client edit detected — enqueued calendar:detect-edits',
        );

        // Advance planning cycle to workbook_built (fallback path; the primary
        // transition is build-workbook's own onWorkbookBuilt, matched by csvFileId).
        // The workbook is named for the PLAN month; the owning cycle's cycle_month
        // is the DATA month, one earlier (plan = data month + 1).
        const planMonth = parseWorkbookMonth(meta.name);
        const cycleMonth = planMonth !== null ? prevMonth(planMonth) : null;
        if (cycleMonth !== null) {
          try {
            const cycleRows = await this.db
              .select()
              .from(contentCycles)
              .where(and(
                eq(contentCycles.clientId,   clientId),
                eq(contentCycles.channel,    channelName),
                eq(contentCycles.cycleMonth, cycleMonth),
                eq(contentCycles.status,     'planning'),
              ))
              .limit(1);

            const cycle = cycleRows[0];
            if (cycle) {
              await transitionCycle(
                this.db, cycle.id, 'workbook_built',
                { workbookRef: change.fileId },
                this.logger,
              );
              this.logger.info(
                { clientId, channel: channelName, cycleMonth, cycleId: cycle.id },
                'drive: planning → workbook_built',
              );
            }
          } catch (err) {
            this.logger.warn(
              { clientId, channel: channelName, cycleMonth, err: String(err) },
              'drive: could not advance planning cycle to workbook_built — non-fatal',
            );
          }
        } else {
          this.logger.warn(
            { clientId, channel: channelName, filename: meta.name },
            'drive: workbook filename did not match expected pattern — planning cycle not advanced',
          );
        }
      } else if (isCsv) {
        // CSV detected — trigger the calendar:build-workbook workflow via the
        // standard incoming-events queue. Look up the contact email from
        // calendar-config.json so the delivery destination can resolve 'sender'.
        let contact: string | null = null;
        try {
          const folderFiles = await drive.listFiles(driveFolderId);
          const configMeta  = folderFiles.find((f) => f.name === 'calendar-config.json');
          if (configMeta) {
            const configBuf = await drive.downloadFile(configMeta.id);
            const config    = JSON.parse(configBuf.toString('utf-8')) as Record<string, unknown>;
            contact = (config['contact'] as string | undefined) ?? null;
          }
        } catch (err) {
          this.logger.warn(
            { clientId, channel: channelName, err: String(err) },
            'drive: could not read calendar-config.json for contact email',
          );
        }

        const [newEvent] = await this.db
          .insert(incomingEvents)
          .values({
            clientId,
            source: 'drive',
            sourceMetadata: {
              csvFileId:    change.fileId,
              csvName:      meta.name,
              channel:      channelName,
              driveFolderId,
              from:         contact,
            },
            content: { text: `CSV updated: ${meta.name}` },
            receivedAt: new Date(),
            status: 'received',
            externalId,
          })
          .returning({ id: incomingEvents.id });

        if (!newEvent) throw new Error('Failed to create incoming_events row for CSV trigger');

        await this.db.insert(processedExternalIds).values({
          clientId,
          source:      'drive',
          externalId,
          processedAt: new Date(),
        });

        await this.incomingQueue.add(
          'incoming-events',
          { eventId: newEvent.id, clientId, directWorkflowId: 'sprigly-calendar-build-workbook' },
        );

        this.logger.info(
          { clientId, channel: channelName, fileId: change.fileId, name: meta.name, eventId: newEvent.id },
          'drive: CSV change detected — enqueued calendar:build-workbook',
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
