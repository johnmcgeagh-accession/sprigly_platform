/**
 * seed-cycle-config.ts — one-off data migration: populate the four new
 * client_channels columns from each client's calendar-config.json on Drive.
 *
 * Usage:
 *   pnpm seed-cycle-config [--dry-run] [--force]
 *
 *   --dry-run  Log what would be written; make no DB changes.
 *   --force    Overwrite rows where the columns are already populated.
 *
 * Default (no flags): skips any row where instagramHandle or contactEmail
 * is already set (assumes it was previously seeded). Use --force to re-read
 * Drive and overwrite.
 *
 * Run AFTER migration 0040 has been applied to the target database.
 */

import { eq, and } from 'drizzle-orm';
import { db, clientChannels, clients } from '@sprigly/db';
import { getTokens, storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import pino from 'pino';

const logger = pino({ name: 'seed-cycle-config' });

const args   = process.argv.slice(2);
const DRY    = args.includes('--dry-run');
const FORCE  = args.includes('--force');

if (DRY) logger.info('DRY RUN — no changes will be written');

const encProvider = createEncryptionProvider();

interface ParsedConfig {
  instagramHandle?:      string;
  contactEmail?:         string;
  contactName?:          string;
  contentCycleSchedule?: { day: number; hour: number; cutoffDay?: number | null };
  extraQuestions?:       string[];
}

function parseConfig(raw: Record<string, unknown>, logCtx: Record<string, unknown>): ParsedConfig {
  const out: ParsedConfig = {};

  if (typeof raw['instagram_handle'] === 'string') {
    out.instagramHandle = raw['instagram_handle'];
  }

  if (typeof raw['contact_email'] === 'string') {
    out.contactEmail = raw['contact_email'];
  }

  if (typeof raw['contact_name'] === 'string') {
    out.contactName = raw['contact_name'];
  }

  const sched = raw['content_cycle_schedule'];
  if (sched && typeof sched === 'object' && !Array.isArray(sched)) {
    const s = sched as Record<string, unknown>;
    const day  = typeof s['day']  === 'number' ? Math.max(1, Math.min(28, s['day']))  : undefined;
    const hour = typeof s['hour'] === 'number' ? Math.max(0, Math.min(23, s['hour'])) : undefined;
    // Optional auto-run cutoff date; carried through when present so config seeds can set it.
    const cutoffDay = typeof s['cutoffDay'] === 'number' ? Math.max(1, Math.min(28, s['cutoffDay'])) : undefined;
    if (day !== undefined && hour !== undefined) {
      out.contentCycleSchedule = cutoffDay !== undefined ? { day, hour, cutoffDay } : { day, hour };
    } else {
      logger.warn(logCtx, 'seed-cycle-config: content_cycle_schedule present but invalid shape — skipping field');
    }
  }

  if (Array.isArray(raw['extra_questions'])) {
    out.extraQuestions = (raw['extra_questions'] as unknown[])
      .filter((q): q is string => typeof q === 'string');
  }

  return out;
}

async function main(): Promise<void> {
  const rows = await db
    .select({
      id:            clientChannels.id,
      clientId:      clientChannels.clientId,
      channel:       clientChannels.channel,
      driveFolderId: clientChannels.driveFolderId,
      // existing values — skip row unless --force
      instagramHandle:      clientChannels.instagramHandle,
      contactEmail:         clientChannels.contactEmail,
      contactName:          clientChannels.contactName,
      contentCycleSchedule: clientChannels.contentCycleSchedule,
      extraQuestions:       clientChannels.extraQuestions,
      clientName:    clients.name,
    })
    .from(clientChannels)
    .innerJoin(clients, eq(clientChannels.clientId, clients.id));

  logger.info({ count: rows.length }, 'seed-cycle-config: found client_channels rows');

  let seeded   = 0;
  let skipped  = 0;
  let failed   = 0;
  let noop     = 0;

  for (const row of rows) {
    const logCtx = { clientId: row.clientId, channel: row.channel, client: row.clientName };

    if (!row.driveFolderId) {
      logger.info(logCtx, 'seed-cycle-config: no driveFolderId — skipping');
      skipped++;
      continue;
    }

    // Skip if already populated and not forcing
    const alreadyPopulated = row.instagramHandle !== null || row.contactEmail !== null;
    if (alreadyPopulated && !FORCE) {
      logger.info({ ...logCtx, instagramHandle: row.instagramHandle, contactEmail: row.contactEmail },
        'seed-cycle-config: columns already populated — skipping (use --force to overwrite)');
      noop++;
      continue;
    }

    const tokens = await getTokens(db, encProvider, row.clientId, 'drive');
    if (!tokens) {
      logger.warn(logCtx, 'seed-cycle-config: no Drive tokens — skipping');
      skipped++;
      continue;
    }

    let cfg: ParsedConfig;
    try {
      const drive = new DriveApiClient(
        process.env['GOOGLE_CLIENT_ID']!,
        process.env['GOOGLE_CLIENT_SECRET']!,
        tokens,
        async (t) => {
          try { await storeTokens(db, encProvider, row.clientId, 'drive', t); }
          catch (err) { logger.warn({ ...logCtx, err }, 'seed-cycle-config: token refresh write-back failed'); }
        },
      );

      const files   = await drive.listFiles(row.driveFolderId!);
      const cfgMeta = files.find((f) => f.name === 'calendar-config.json');

      if (!cfgMeta) {
        logger.info(logCtx, 'seed-cycle-config: no calendar-config.json in Drive folder — skipping');
        skipped++;
        continue;
      }

      const buf = await drive.downloadFile(cfgMeta.id);
      const raw = JSON.parse(buf.toString('utf-8')) as Record<string, unknown>;
      cfg = parseConfig(raw, logCtx);
    } catch (err) {
      logger.error({ ...logCtx, err: String(err) }, 'seed-cycle-config: Drive read failed — skipping');
      failed++;
      continue;
    }

    logger.info({ ...logCtx, parsed: cfg }, 'seed-cycle-config: parsed config from Drive');

    if (!DRY) {
      await db
        .update(clientChannels)
        .set({
          instagramHandle:      cfg.instagramHandle      ?? null,
          contactEmail:         cfg.contactEmail         ?? null,
          contactName:          cfg.contactName          ?? null,
          contentCycleSchedule: cfg.contentCycleSchedule ?? null,
          extraQuestions:       cfg.extraQuestions        ?? null,
        })
        .where(and(
          eq(clientChannels.clientId, row.clientId),
          eq(clientChannels.channel,  row.channel),
        ));
      logger.info(logCtx, 'seed-cycle-config: row updated');
    } else {
      logger.info(logCtx, 'seed-cycle-config: [dry-run] would update row');
    }

    seeded++;
  }

  logger.info({ seeded, skipped, noop, failed, dryRun: DRY },
    'seed-cycle-config: complete');

  // Verification output for IVY-t specifically
  const ivyt = await db
    .select({
      clientId:             clientChannels.clientId,
      channel:              clientChannels.channel,
      instagramHandle:      clientChannels.instagramHandle,
      contactEmail:         clientChannels.contactEmail,
      contactName:          clientChannels.contactName,
      contentCycleSchedule: clientChannels.contentCycleSchedule,
      extraQuestions:       clientChannels.extraQuestions,
    })
    .from(clientChannels)
    .innerJoin(clients, eq(clientChannels.clientId, clients.id))
    .where(eq(clients.slug, 'ivy-t'))
    .limit(1);

  if (ivyt[0]) {
    logger.info({ row: ivyt[0] }, 'seed-cycle-config: IVY-t verification row');
  }
}

main().catch((err) => {
  logger.fatal({ err: String(err) }, 'seed-cycle-config: fatal error');
  process.exit(1);
});
