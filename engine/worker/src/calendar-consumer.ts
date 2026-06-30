/**
 * calendar-consumer.ts — BullMQ worker for the calendar-events queue.
 *
 * Handles `calendar:detect-edits` jobs enqueued by drive-poller when a client
 * edits their content-calendar workbook in Google Sheets.
 *
 * Steps (all deterministic — zero LLM calls):
 *   1. Download the edited xlsx from Drive.
 *   2. Optionally download calendar-config.json for --config arg.
 *   3. Run extract_edits.py; parse stdout JSON.
 *   4. Validate the JSON shape inline.
 *   5. Zero changed rows → log and return cleanly (blank-means-approved).
 *   6. ≥1 changed rows → insert voice_edits rows (ingested_at=null, ingestion_run_id=null).
 *      These are PENDING. The daily batch merge in voice-batch-merge.ts consumes them.
 *      No voice_ingestion_runs row is created here; that is done by the merge.
 */

import { Worker } from 'bullmq';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  db as _db,
  voiceEdits,
} from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { Logger } from 'pino';

type Db = typeof _db;

interface DetectEditsJob {
  clientId: string;
  channel: string;
  fileId: string;
  driveFolderId: string;
}

interface EditRow {
  date: string;
  post_title: string;
  category: string;
  pillar: string;
  sprigly_draft: string;
  amended: string;
  notes: string;
  changed: boolean;
}

interface ExtractEditsResult {
  client: string;
  contact: string;
  month: string;
  edits: EditRow[];
  summary: {
    total_posts: number;
    edited: number;
    edit_rate: number;
  };
}

function runPython(bin: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`extract_edits.py timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`extract_edits.py exited ${code ?? 'null'}:\n${stderr}`));
      else resolve(stdout);
    });
    proc.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
}

function validateExtractResult(raw: unknown): ExtractEditsResult {
  if (typeof raw !== 'object' || raw === null) throw new Error('extract output is not an object');
  const r = raw as Record<string, unknown>;

  if (typeof r['month'] !== 'string' || !/^\d{4}-\d{2}$/.test(r['month'])) {
    throw new Error(`extract output has invalid month: ${String(r['month'])}`);
  }
  if (!Array.isArray(r['edits'])) throw new Error('extract output missing edits array');

  const summary = r['summary'] as Record<string, unknown> | undefined;
  if (!summary || typeof summary['edited'] !== 'number') {
    throw new Error('extract output missing summary.edited');
  }
  if ((r['edits'] as unknown[]).length !== summary['edited']) {
    throw new Error(
      `extract output edits.length (${(r['edits'] as unknown[]).length}) ≠ summary.edited (${summary['edited']})`,
    );
  }

  for (const [i, e] of (r['edits'] as unknown[]).entries()) {
    if (typeof e !== 'object' || e === null) throw new Error(`edits[${i}] is not an object`);
    const edit = e as Record<string, unknown>;
    if (edit['changed'] !== true) throw new Error(`edits[${i}].changed is not true`);
    if (typeof edit['amended'] !== 'string' && typeof edit['notes'] !== 'string') {
      throw new Error(`edits[${i}] has neither amended nor notes`);
    }
  }

  return r as unknown as ExtractEditsResult;
}

export function createCalendarConsumer(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  extractScriptPath: string,
  pythonBin: string,
  logger: Logger,
  redisUrl: string,
): Worker {
  return new Worker(
    'calendar-events',
    async (job) => {
      const { clientId, channel, fileId, driveFolderId } = job.data as DetectEditsJob;
      const runLogCtx = { clientId, channel, fileId, jobId: job.id };

      const tokens = await getTokens(db, encProvider, clientId, 'drive');
      if (!tokens) throw new Error(`No Drive tokens for client ${clientId}`);

      const drive = new DriveApiClient(
        googleClientId,
        googleClientSecret,
        tokens,
        (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
      );

      const runId = `cal-detect-${job.id ?? Date.now()}`;
      const tmpDir = join(tmpdir(), runId);
      mkdirSync(tmpDir, { recursive: true });

      try {
        // ── 1. Download edited xlsx ───────────────────────────────────────────
        logger.info({ ...runLogCtx }, 'detect-edits: downloading xlsx');
        const xlsxBuf = await drive.downloadFile(fileId);
        // Derive filename from folder listing — we only have fileId in the job.
        const meta = await drive.getFileMeta(fileId);
        const xlsxPath = join(tmpDir, meta.name);
        writeFileSync(xlsxPath, xlsxBuf);

        // ── 2. Download calendar-config.json if app-owned ────────────────────
        let configPath: string | undefined;
        try {
          const folderFiles = await drive.listFiles(driveFolderId);
          const configMeta  = folderFiles.find((f) => f.name === 'calendar-config.json');
          if (configMeta) {
            const configBuf = await drive.downloadFile(configMeta.id);
            configPath = join(tmpDir, 'calendar-config.json');
            writeFileSync(configPath, configBuf);
          }
        } catch {
          logger.warn({ ...runLogCtx }, 'detect-edits: could not fetch calendar-config.json — proceeding without');
        }

        // ── 3. Run extract_edits.py ──────────────────────────────────────────
        const outPath = join(tmpDir, 'edits.json');
        const pyArgs = [extractScriptPath, xlsxPath, '--out', outPath];
        if (configPath) pyArgs.splice(2, 0, '--config', configPath);

        logger.info({ ...runLogCtx }, 'detect-edits: running extract_edits.py');
        await runPython(pythonBin, pyArgs);

        // ── 4. Parse and validate ────────────────────────────────────────────
        const raw: unknown = JSON.parse(readFileSync(outPath, 'utf-8'));
        // TODO(Stage 7): validate against packages/contracts/.../edits.schema.json
        const result = validateExtractResult(raw);

        // ── 5. Blank-means-approved: zero changed rows → exit cleanly ────────
        if (result.edits.length === 0) {
          logger.info({ ...runLogCtx, totalPosts: result.summary.total_posts }, 'detect-edits: no client edits, skipping');
          return;
        }

        // ── 6. Write pending voice_edits rows ────────────────────────────────
        // ingested_at=null and ingestion_run_id=null marks them PENDING.
        // The daily batch merge (voice-batch-merge.ts) consumes them.
        const month = result.month;
        logger.info({ ...runLogCtx, month, editCount: result.edits.length }, 'detect-edits: writing pending edits to DB');

        await db.insert(voiceEdits).values(
          result.edits.map((edit, i) => ({
            clientId,
            channel,
            month,
            postIndex: i + 1,
            date:           edit.date          || null,
            postTitle:      edit.post_title    || null,
            category:       edit.category      || null,
            pillar:         edit.pillar        || null,
            spriglyDraft:   edit.sprigly_draft || null,
            contactAmended: edit.amended       || null,
            notes:          edit.notes         || null,
          })),
        );

        logger.info(
          { ...runLogCtx, month, editCount: result.edits.length },
          'detect-edits: pending edits written — batch merge will consume tonight',
        );
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    { connection: { url: redisUrl }, concurrency: 2 },
  );
}
