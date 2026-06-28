/**
 * planning.ts — content-cycle planning worker (intake_confirmed → planning).
 *
 * STAGE 1 (current): WIRING PROOF. Assembles the four planning inputs, logs what
 * it found, then emits a TRIVIAL placeholder plan CSV (3 posts) with the exact
 * 13-column contract the build-workbook pipeline consumes, uploads it to the
 * client's Drive folder, records draft_csv_ref, and transitions to 'planning'.
 *
 * The CSV upload is the handoff — this worker's responsibility ENDS at "CSV in
 * Drive". The existing pipeline takes over:
 *   CSV in Drive → DrivePoller (.csv branch) → sprigly-calendar-build-workbook
 *     → .xlsx in Drive → DrivePoller (.xlsx branch) → planning → workbook_built.
 *
 * STAGE 2 (next): replace buildPlaceholderPlanCsv() with the single Bedrock call
 * (skill steps 5-8) over the SAME assembled inputs. Everything else is unchanged —
 * the wiring proven here is the load-bearing part.
 *
 * Inputs assembled (all degrade gracefully when absent, per the "never block" rule):
 *   - intakeJson.planContent  — on the content_cycles row (primary planning signal)
 *   - client_planning_config  — pillars / competitors / cadence / series / times / categories
 *   - competitor_gather_cache — Stage 1 deterministic gather (Stage 2 analysis does NOT exist)
 *   - voice.md                — read from the client's Drive folder
 *
 * On error: → failed, failed_step='planning' (CSV not guaranteed; safe to retry).
 */

import { eq, and } from 'drizzle-orm';
import {
  db as _db,
  contentCycles,
  clientPlanningConfig,
  competitorGatherCache,
  clientChannels,
  clients,
} from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { DbPromptResolver } from '@sprigly/prompts';
import type { IntakeJson, CompetitorGatherData } from '@sprigly/engine';
import type { Logger } from 'pino';
import { transitionCycle } from './machine.js';

type Db = typeof _db;

export interface PlanningDeps {
  db:                 Db;
  encProvider:        EncryptionProvider;
  googleClientId:     string;
  googleClientSecret: string;
  // model / prompts / audit are unused in STAGE 1 — wired now so the consumer
  // call site is final and STAGE 2 is a body-only change.
  model:              ModelClient;
  prompts:            DbPromptResolver;
  audit:              AuditLogger;
  logger:             Logger;
}

// ── CSV emission (QUOTE_ALL, matching the skill's csv.DictWriter contract) ─────

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Quote every field and double internal quotes — equivalent to Python's
 *  csv.writer(quoting=csv.QUOTE_ALL). Uses \r\n line endings to match csv default. */
function csvQuoteAll(rows: string[][]): string {
  return rows
    .map((row) => row.map((f) => `"${f.replace(/"/g, '""')}"`).join(','))
    .join('\r\n') + '\r\n';
}

/**
 * The EXACT 13-column header the build-workbook pipeline consumes. Columns 1-10
 * are read by literal key (drift = silently empty cell); columns 11-13 are
 * resolved tolerantly by the Python (substring "Sprigly Notes" / suffix
 * "Amended Caption" / suffix "Notes / Questions"), so the {contact} substitution
 * is safe. Columns 12-13 are always blank — the client fills them in the workbook.
 */
function planCsvHeader(contact: string): string[] {
  return [
    'Date',
    'Day',
    'Post Title / Theme',
    'Category',
    'Pillar',
    'Format',
    'Posting Time',
    'Who Posts',
    'Competitor Insight (why this was recommended)',
    'Sprigly Draft Caption',
    `Sprigly Notes (context for ${contact})`,
    `${contact}'s Amended Caption`,
    `${contact}'s Notes / Questions`,
  ];
}

/** STAGE 1 placeholder plan: 3 valid rows proving the column contract + pipeline.
 *  Dates use the "D Mon" form that generate_calendar.py's parse_day() accepts. */
function buildPlaceholderPlanCsv(contact: string, cycleMonth: string): string {
  const monthNum = Number(cycleMonth.split('-')[1]);
  const abbr     = MONTH_ABBR[monthNum - 1] ?? 'Jan';

  const samples: Array<Record<string, string>> = [
    {
      Date: `5 ${abbr}`, Day: 'Mon', title: 'STAGE 1 placeholder — pillar post',
      category: 'Educational', pillar: 'Placeholder Pillar', format: 'Static', time: '7pm',
      who: 'Sprigly',
      insight: 'Placeholder insight — real competitor reasoning lands in Stage 2.',
      caption: 'Placeholder caption one. Replaced by the real planning agent in Stage 2.',
      notes: 'Stage 1 wiring proof — not a real post.',
    },
    {
      Date: `14 ${abbr}`, Day: 'Wed', title: 'STAGE 1 placeholder — engagement post',
      category: 'Community', pillar: 'Placeholder Pillar', format: 'Reel', time: '6pm',
      who: 'Sprigly',
      insight: 'Placeholder insight — real competitor reasoning lands in Stage 2.',
      caption: 'Placeholder caption two. Replaced by the real planning agent in Stage 2.',
      notes: 'Stage 1 wiring proof — not a real post.',
    },
    {
      Date: `23 ${abbr}`, Day: 'Fri', title: 'STAGE 1 placeholder — product post',
      category: 'Product', pillar: 'Placeholder Pillar', format: 'Carousel', time: '12pm',
      who: 'Sprigly',
      insight: 'Placeholder insight — real competitor reasoning lands in Stage 2.',
      caption: 'Placeholder caption three. Replaced by the real planning agent in Stage 2.',
      notes: 'Stage 1 wiring proof — not a real post.',
    },
  ];

  const rows: string[][] = [planCsvHeader(contact)];
  for (const s of samples) {
    rows.push([
      s.Date!, s.Day!, s.title!, s.category!, s.pillar!, s.format!, s.time!, s.who!,
      s.insight!, s.caption!, s.notes!,
      '',  // {contact}'s Amended Caption — always blank
      '',  // {contact}'s Notes / Questions — always blank
    ]);
  }
  return csvQuoteAll(rows);
}

// ── Worker ─────────────────────────────────────────────────────────────────────

/**
 * Run the planning phase for one cycle. Idempotent: a cycle not in
 * 'intake_confirmed' is logged and skipped (covers retries and double-enqueues).
 * The CSV upload itself is idempotent — an existing same-named file is overwritten.
 */
export async function runPlanningForCycle(
  cycleId: string,
  deps:    PlanningDeps,
): Promise<void> {
  const { db, encProvider, googleClientId, googleClientSecret, logger } = deps;

  const rows = await db
    .select()
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  const cycle = rows[0];
  if (!cycle) throw new Error(`runPlanningForCycle: cycle ${cycleId} not found`);

  const { clientId, channel, cycleMonth, status } = cycle;
  const logCtx = { cycleId, clientId, channel, cycleMonth };

  if (status !== 'intake_confirmed') {
    logger.info({ ...logCtx, status }, 'content-cycles: planning skipped — cycle not in intake_confirmed');
    return;
  }

  try {
    // ── Assemble inputs (each optional; never block) ──────────────────────────
    const intake     = cycle.intakeJson as IntakeJson | null;
    const answers    = intake?.planContent?.answers ?? {};
    const freeNotes  = (intake?.planContent?.freeNotes ?? '').trim();

    const [planConfigRow] = await db
      .select()
      .from(clientPlanningConfig)
      .where(and(
        eq(clientPlanningConfig.clientId, clientId),
        eq(clientPlanningConfig.channel,  channel),
      ))
      .limit(1);

    const [gatherRow] = await db
      .select()
      .from(competitorGatherCache)
      .where(and(
        eq(competitorGatherCache.clientId, clientId),
        eq(competitorGatherCache.channel,  channel),
      ))
      .limit(1);
    const gather = (gatherRow?.rawData as CompetitorGatherData | undefined) ?? null;

    const [clientRow] = await db
      .select({ name: clients.name, slug: clients.slug })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    const slug = clientRow?.slug ?? 'client';

    const [channelRow] = await db
      .select({ driveFolderId: clientChannels.driveFolderId, contactName: clientChannels.contactName })
      .from(clientChannels)
      .where(and(
        eq(clientChannels.clientId, clientId),
        eq(clientChannels.channel,  channel),
      ))
      .limit(1);

    const driveFolderId = channelRow?.driveFolderId ?? null;
    const contact       = (channelRow?.contactName ?? '').trim() || 'the client';

    // Drive is required for the handoff — without it the CSV can't be delivered.
    const tokens = await getTokens(db, encProvider, clientId, 'drive');
    if (!tokens) throw new Error(`runPlanningForCycle: no Drive tokens for client ${clientId}`);
    if (!driveFolderId) throw new Error(`runPlanningForCycle: no drive_folder_id for ${clientId}/${channel}`);

    const drive = new DriveApiClient(
      googleClientId, googleClientSecret, tokens,
      (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
    );

    const folderFiles = await drive.listFiles(driveFolderId);

    // voice.md — read for the log now; consumed by the prompt in Stage 2.
    let voiceMd: string | null = null;
    const voiceMeta = folderFiles.find((f) => f.name === 'voice.md');
    if (voiceMeta) {
      try {
        voiceMd = (await drive.downloadFile(voiceMeta.id)).toString('utf-8');
      } catch (err) {
        logger.warn({ ...logCtx, err: String(err) }, 'content-cycles: planning could not read voice.md — continuing without');
      }
    }

    // ── Log the assembled inputs (the Stage 1 observability requirement) ──────
    logger.info(
      {
        ...logCtx,
        contact,
        slug,
        planContent: {
          present:      Object.keys(answers).length > 0 || freeNotes.length > 0,
          answersCount: Object.keys(answers).length,
          freeNotesLen: freeNotes.length,
        },
        planConfig: planConfigRow
          ? {
              present:         true,
              pillars:         (planConfigRow.pillars         ?? []).length,
              competitors:     (planConfigRow.competitors     ?? []).length,
              categories:      (planConfigRow.categories      ?? []).length,
              recurringSeries: (planConfigRow.recurringSeries ?? []).length,
            }
          : { present: false },
        competitorGather: gather
          ? { present: true, accounts: gather.accounts?.length ?? 0, benchmark: gather.benchmark?.length ?? 0, gatheredAt: gather.gatheredAt }
          : { present: false, note: 'no competitor gather data — Stage 2 plan would use pillars-only balance' },
        voice: { present: voiceMd !== null, length: voiceMd?.length ?? 0 },
      },
      'content-cycles: planning inputs assembled',
    );

    // ── Emit the plan CSV (STAGE 1: placeholder) ──────────────────────────────
    const filename = `${cycleMonth}_${slug}-instagram-plan.csv`;
    const csv      = buildPlaceholderPlanCsv(contact, cycleMonth);
    const csvBuf   = Buffer.from(csv, 'utf-8');

    // Idempotent upload: overwrite an existing same-named CSV rather than create a duplicate.
    const existingCsv = folderFiles.find((f) => f.name === filename);
    let csvFileId: string;
    if (existingCsv) {
      await drive.updateFile(existingCsv.id, 'text/csv', csvBuf);
      csvFileId = existingCsv.id;
    } else {
      csvFileId = await drive.uploadFile(driveFolderId, filename, 'text/csv', csvBuf);
    }

    logger.info({ ...logCtx, filename, csvFileId }, 'content-cycles: planning CSV uploaded to Drive');

    // ── intake_confirmed → planning ───────────────────────────────────────────
    // Must precede the workbook landing: the DrivePoller xlsx branch advances
    // planning → workbook_built and only matches a cycle already in 'planning'.
    await transitionCycle(db, cycleId, 'planning', { draftCsvRef: csvFileId }, logger);

    logger.info({ ...logCtx, csvFileId }, 'content-cycles: planning complete — handed off to build-workbook pipeline');
  } catch (err) {
    logger.error({ ...logCtx, err: String(err) }, 'content-cycles: planning phase failed');
    await transitionCycle(db, cycleId, 'failed', { failedStep: 'planning' }, logger)
      .catch((te) => {
        logger.error({ ...logCtx, err: String(te) }, 'content-cycles: failed to transition to failed state');
      });
    throw err;
  }
}
