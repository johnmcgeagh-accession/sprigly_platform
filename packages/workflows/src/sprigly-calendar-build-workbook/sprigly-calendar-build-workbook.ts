import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import type { Workflow, WorkflowContext, IncomingEvent } from '@sprigly/engine';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { SpriglyCalendarBuildWorkbookInput, SpriglyCalendarBuildWorkbookOutput } from './types.js';
import { parseCalendarBuildWorkbookInput } from './parse-input.js';

// The @sprigly/db type is resolved transitively via @sprigly/oauth-tokens.
// Using `unknown` here avoids adding @sprigly/db as a direct dep of @sprigly/workflows
// while keeping the db reference strongly typed at the call site.
type AnyDb = Parameters<typeof getTokens>[0];

function runPython(bin: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`generate_calendar.py timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`generate_calendar.py exited ${code ?? 'null'}:\n${stderr}`));
      else resolve(stdout);
    });
    proc.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
}

export type DeliverySurface = 'app' | 'sheet' | 'both';

/** Compose the delivery email body, branched on the client's delivery surface.
 *  'sheet' → workbook link only (the original behaviour); 'app' → app link only
 *  (falls back to the workbook link if no app link could be minted); 'both' → both. */
export function buildDeliveryBody(
  surface: DeliverySurface,
  driveUrl: string,
  appUrl: string | null,
  month: string,
  year: string,
): string {
  const sheetBlock = `Open and edit it here:\n${driveUrl}\n\nOnce you've made any changes, just save — Sprigly will pick up your edits automatically.`;
  const appBlock = appUrl
    ? `Open and shape it here:\n${appUrl}\n\nMove posts, edit captions and add ideas — your changes save as you go.`
    : null;

  let middle: string;
  if (surface === 'app')        middle = appBlock ?? sheetBlock;     // app pref, but never leave them no link
  else if (surface === 'sheet') middle = sheetBlock;
  else                          middle = appBlock ? `${appBlock}\n\nPrefer a spreadsheet? You can also open it here:\n${driveUrl}` : sheetBlock;

  return `Hi,\n\nYour Sprigly content calendar for ${month} ${year} is ready.\n\n${middle}\n\nBest,\nSprigly`;
}

export function createCalendarBuildWorkbookWorkflow(
  db: AnyDb,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  calScriptPath: string,
  pythonBin: string,
  /** Called after every Drive write with `fileId:modifiedTime` so the caller can
   *  record a self-write ledger entry. The drive-poller checks this ledger to
   *  suppress detect-edits for Sprigly's own workbook writes. */
  onSelfWrite?: (clientId: string, externalId: string) => Promise<void>,
  /** Called after the workbook is uploaded so the caller can advance the content
   *  cycle planning → workbook_built. build-workbook owns this transition because
   *  its own xlsx write is self-write-suppressed in the drive-poller — the poller
   *  would otherwise only advance the cycle on a LATER client edit. The cycle is
   *  matched by csvFileId (the plan CSV's Drive id, stored as the cycle's
   *  draft_csv_ref) — NOT by month, because the plan/workbook month is the cycle's
   *  data month + 1 and would not match cycle_month. Injected by the worker, which
   *  owns @sprigly/db + the cycle state machine. */
  onWorkbookBuilt?: (
    clientId: string,
    channel: string,
    csvFileId: string,
    workbookFileId: string,
  ) => Promise<void>,
  /** Returns the client/channel's delivery surface preference. Injected by the
   *  worker (which owns @sprigly/db); absent → 'both'. */
  deliverySurfaceFor?: (clientId: string, channel: string) => Promise<DeliverySurface>,
  /** Mints a revocable app magic link for the cycle being delivered (matched by
   *  csvFileId = draft_csv_ref). Injected by the worker; absent → no app link. */
  mintAppLink?: (clientId: string, channel: string, csvFileId: string) => Promise<string | null>,
): Workflow<SpriglyCalendarBuildWorkbookInput, SpriglyCalendarBuildWorkbookOutput> {
  return {
    id: 'sprigly-calendar-build-workbook',
    defaultDestinations: [
      {
        destinationId: 'gmail-reply-with-attachment',
        requireApproval: false,
        settings: {
          // ⚠️⚠️⚠️ TEMPORARY — STAGE 1 LIVE STUB-RUN SAFEGUARD — REVERT AFTER THE RUN ⚠️⚠️⚠️
          // Pinned to John's test address so the trivial stub plan CANNOT reach a real
          // client. Delivery normally reads the recipient from the STALE Drive
          // calendar-config.json (sourceMetadata.from), NOT client_channels.contact_email,
          // so the DB being correct does not make the Drive-sourced recipient safe.
          // Pinning to mode:'address' removes that dependency entirely for this run.
          // REVERT to `to: { mode: 'sender' }` once workbook_built is proven live.
          to: { mode: 'address', address: 'john.mcgeagh@gmail.com' },
          // ── original (restore on revert): to: { mode: 'sender' } ──
          // 'sender' mode reads event.reply.data['from'], which equals sourceMetadata.from —
          // the contact email extracted from calendar-config.json by the drive poller.
          subjectTemplate: 'Content calendar ready — {{month}} {{year}}',
          // The body is composed per-run in run() (branched on delivery_surface) and
          // returned as `body`; this template just substitutes it.
          bodyTemplate: '{{body}}',
          attachmentFilenameTemplate: '{{filename}}',
          noAttachment: true,
        },
      },
    ],

    parseInput(event: IncomingEvent): SpriglyCalendarBuildWorkbookInput | null {
      return parseCalendarBuildWorkbookInput(event);
    },

    async run(
      input: SpriglyCalendarBuildWorkbookInput,
      ctx: WorkflowContext,
    ): Promise<SpriglyCalendarBuildWorkbookOutput> {
      const tokens = await getTokens(db, encProvider, input.clientId, 'drive');
      if (!tokens) throw new Error(`No Drive tokens for client ${input.clientId}`);

      const drive = new DriveApiClient(
        googleClientId,
        googleClientSecret,
        tokens,
        (refreshed) => storeTokens(db, encProvider, input.clientId, 'drive', refreshed),
      );

      const tmpDir = join(tmpdir(), `cal-build-${ctx.runId}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        // ── 1. Download CSV ───────────────────────────────────────────────────
        const csvBuffer = await drive.downloadFile(input.csvFileId);
        const csvPath = join(tmpDir, input.csvName);
        writeFileSync(csvPath, csvBuffer);

        // ── 2. Download calendar-config.json if present ───────────────────────
        let configPath: string | undefined;
        let contactEmail: string | undefined;
        const folderFiles = await drive.listFiles(input.driveFolderId);
        const configMeta  = folderFiles.find((f) => f.name === 'calendar-config.json');
        if (configMeta) {
          const configBuf = await drive.downloadFile(configMeta.id);
          configPath = join(tmpDir, 'calendar-config.json');
          writeFileSync(configPath, configBuf);
          try {
            const cfg = JSON.parse(configBuf.toString('utf-8')) as Record<string, unknown>;
            contactEmail = cfg['contact'] as string | undefined;
          } catch { /* config parse failure is non-fatal */ }
        }

        // ── 3. Run generate_calendar.py ───────────────────────────────────────
        const pyArgs = [calScriptPath, csvPath, '--out', tmpDir];
        if (configPath) pyArgs.splice(2, 0, '--config', configPath);

        const stdout = await runPython(pythonBin, pyArgs);

        // Parse the "Saved:      <path>" line
        const savedLine = stdout.split('\n').find((l) => l.trimStart().startsWith('Saved:'));
        if (!savedLine) throw new Error(`generate_calendar.py: no "Saved:" line in stdout:\n${stdout}`);
        const xlsxPath = savedLine.replace(/^\s*Saved:\s*/, '').trim();

        // ── 4. Read xlsx ──────────────────────────────────────────────────────
        const xlsxBuffer = readFileSync(xlsxPath);
        const filename   = basename(xlsxPath);

        // Extract month and year from: "{client} — Content calendar - {Month} {Year}.xlsx"
        const match = filename.match(/- (\w+) (\d{4})\.xlsx$/);
        const month = match?.[1] ?? '';
        const year  = match?.[2] ?? '';

        // ── 5. Upload to Drive (update existing workbook or create new) ───────
        const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const existing = folderFiles.find((f) => f.name === filename);
        let fileId: string;
        if (existing) {
          await drive.updateFile(existing.id, xlsxMime, xlsxBuffer);
          fileId = existing.id;
        } else {
          fileId = await drive.createFile(input.driveFolderId, filename, xlsxMime, xlsxBuffer);
        }

        // ── 6. Share with contact so the Drive link works for them ────────────
        if (contactEmail) {
          try {
            await drive.shareFile(fileId, contactEmail, 'writer');
          } catch { /* non-fatal — link still included in email */ }
        }

        // ── 7. Record self-write ledger entry ─────────────────────────────────
        // Fetch the file's modifiedTime AFTER the write so the ledger key matches
        // what the drive-poller will compute: `${fileId}:${modifiedTime}`.
        // The poller uses this to suppress detect-edits for this specific write.
        // A later client edit produces a new modifiedTime → different key → fires.
        if (onSelfWrite) {
          try {
            const updatedMeta = await drive.getFileMeta(fileId);
            await onSelfWrite(input.clientId, `${fileId}:${updatedMeta.modifiedTime}`);
          } catch { /* non-fatal — worst case: detect-edits fires and finds no changes */ }
        }

        // ── 8. Advance the content cycle planning → workbook_built ────────────
        // build-workbook owns this transition: it just built the workbook, and
        // the drive-poller self-suppresses this very write (so it can't advance
        // the cycle until a later client edit). cycleMonth comes from the plan
        // CSV filename prefix "YYYY-MM_", which the planning worker guarantees.
        // Non-fatal: the workbook is built + delivered regardless of cycle-state
        // bookkeeping, and the drive-poller stays a fallback for the 'planning'
        // case if this callback is absent or fails.
        if (onWorkbookBuilt) {
          try {
            await onWorkbookBuilt(input.clientId, input.channel, input.csvFileId, fileId);
          } catch { /* non-fatal — see note above */ }
        }

        const driveUrl = `https://drive.google.com/file/d/${fileId}/edit`;

        // ── 9. Delivery surface: branch the email body (app / sheet / both) ───
        const surface: DeliverySurface = deliverySurfaceFor
          ? await deliverySurfaceFor(input.clientId, input.channel).catch(() => 'both' as DeliverySurface)
          : 'both';
        let appUrl: string | null = null;
        if ((surface === 'app' || surface === 'both') && mintAppLink) {
          appUrl = await mintAppLink(input.clientId, input.channel, input.csvFileId).catch(() => null);
        }
        const body = buildDeliveryBody(surface, driveUrl, appUrl, month, year);

        return { filename, month, year, driveUrl, appUrl, body };
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}
