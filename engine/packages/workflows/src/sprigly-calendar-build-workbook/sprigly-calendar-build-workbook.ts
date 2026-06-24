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

export function createCalendarBuildWorkbookWorkflow(
  db: AnyDb,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  calScriptPath: string,
  pythonBin: string,
): Workflow<SpriglyCalendarBuildWorkbookInput, SpriglyCalendarBuildWorkbookOutput> {
  return {
    id: 'sprigly-calendar-build-workbook',
    defaultDestinations: [
      {
        destinationId: 'gmail-reply-with-attachment',
        requireApproval: false,
        settings: {
          // 'sender' mode reads event.reply.data['from'], which equals sourceMetadata.from —
          // the contact email extracted from calendar-config.json by the drive poller.
          to: { mode: 'sender' },
          subjectTemplate: 'Content calendar ready — {{month}} {{year}}',
          bodyTemplate:
            "Hi,\n\nYour Sprigly content calendar for {{month}} {{year}} is attached.\n\nPlease open it, fill in any notes or amended captions, and save — Sprigly will pick up your edits automatically.\n\nBest,\nSprigly",
          attachmentFilenameTemplate: '{{filename}}',
          attachmentMimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          attachmentDataKey: 'xlsx',
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
        const folderFiles = await drive.listFiles(input.driveFolderId);
        const configMeta  = folderFiles.find((f) => f.name === 'calendar-config.json');
        if (configMeta) {
          const configBuf = await drive.downloadFile(configMeta.id);
          configPath = join(tmpDir, 'calendar-config.json');
          writeFileSync(configPath, configBuf);
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
        if (existing) {
          await drive.updateFile(existing.id, xlsxMime, xlsxBuffer);
        } else {
          await drive.createFile(input.driveFolderId, filename, xlsxMime, xlsxBuffer);
        }

        return { xlsx: xlsxBuffer, filename, month, year };
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}
