/**
 * planning.ts — content-cycle planning worker (intake_confirmed → planning).
 *
 * Ports the sprigly-content-plan skill's reasoning (steps 5-8) as a SINGLE
 * pre-assembled Bedrock call (NOT a tool loop — all inputs are gathered first
 * and passed in the prompt). The model returns structured JSON post rows; the
 * worker serialises them to the exact 13-column CSV the build-workbook pipeline
 * consumes, uploads it to the client's Drive folder, records draft_csv_ref, and
 * transitions to 'planning'.
 *
 * The CSV upload is the handoff — this worker's responsibility ENDS at "CSV in
 * Drive". The existing pipeline takes over:
 *   CSV in Drive → DrivePoller (.csv branch) → sprigly-calendar-build-workbook
 *     → .xlsx in Drive → DrivePoller (.xlsx branch) → planning → workbook_built.
 *
 * Inputs assembled (all degrade gracefully when absent, per the "never block" rule):
 *   - intakeJson.planContent  — on the content_cycles row (PRIMARY planning signal)
 *   - client_planning_config  — pillars / competitors / cadence / series / times / categories
 *   - competitor_gather_cache — Stage 1 deterministic gather (Stage 2 analysis does NOT exist).
 *                               Absent for most clients → plan balances pillars-only and the
 *                               Competitor Insight column says "no competitor data", never fabricated.
 *   - voice.md                — read from the client's Drive folder; applied to every caption
 *
 * The prompt lives in the store (workflowId='planning', stepName='generate-plan'),
 * UI-editable like lean-line. The call logs to the audit/cost ledger
 * (action 'content-cycle:planning') — the biggest model call in the platform.
 *
 * On error: → failed, failed_step='planning' (CSV not guaranteed; safe to retry).
 */

import { eq, and, desc, isNotNull } from 'drizzle-orm';
import {
  db as _db,
  contentCycles,
  clientPlanningConfig,
  competitorGatherCache,
  clientChannels,
  clients,
  voiceEdits,
  clientProductCatalogue,
} from '@sprigly/db';
import type { ClientPlanningConfig } from '@sprigly/db';
import type { Catalogue } from '../catalogue/parse-catalogue.js';
import { indexCatalogue, applyCatalogueValidation, buildCatalogueGroundingBlock } from '../catalogue/validate-catalogue.js';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { DbPromptResolver } from '@sprigly/prompts';
import type { IntakeJson, CompetitorGatherData } from '@sprigly/engine';
import type { Logger } from 'pino';
import { transitionCycle } from './machine.js';
import { applyCodeGate, applyCritic } from './plan-validation.js';
import type { PlanPostRow, HistoricPost, VoiceEditExample, PlanRepairContext } from './plan-validation.js';
import type { DriveFileMeta } from '@sprigly/sources';

type Db = typeof _db;

export interface PlanningDeps {
  db:                 Db;
  encProvider:        EncryptionProvider;
  googleClientId:     string;
  googleClientSecret: string;
  model:              ModelClient;
  prompts:            DbPromptResolver;
  audit:              AuditLogger;
  logger:             Logger;
}

// Prompt store coordinates — resolved at runtime, UI-editable like lean-line.
// Seeded by migration 0043_planning_prompt.sql. Throw-on-missing (no in-source
// fallback) so a missing row surfaces immediately rather than silently degrading.
export const PLANNING_WORKFLOW    = 'planning';
export const PLANNING_STEP        = 'generate-plan';
export const PLANNING_CRITIC_STEP = 'validate-plan';

// The logical model for the plan generation call. Sonnet: this is the platform's
// largest single reasoning call (a full month of briefed posts + captions).
const PLANNING_MODEL = 'sonnet';
const PLANNING_MAX_TOKENS = 16_000;

// ── CSV emission (QUOTE_ALL, matching the skill's csv.DictWriter contract) ─────

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

// ── Model output contract ───────────────────────────────────────────────────────

// PlanPostRow (the model's per-post JSON shape) is defined in ./plan-validation.ts
// and shared with the code gate. The two {contact} edit columns are added blank by
// the worker, never the model. All fields are coerced to strings on serialise.

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Extract a JSON object from a model response, tolerating ```json fences and
 *  surrounding prose (mirrors sprigly-blog-post's extractJson). Throws on
 *  unparseable output so the cycle fails loudly and retries rather than shipping
 *  a malformed plan. */
function parsePlanResponse(text: string): PlanPostRow[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  // If still wrapped in prose, slice to the outermost JSON object.
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start !== -1 && end > start) raw = raw.slice(start, end + 1);
  }
  const parsed = JSON.parse(raw) as unknown;
  const posts = Array.isArray(parsed)
    ? parsed
    : (parsed as { posts?: unknown }).posts;
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error('planning: model response had no "posts" array');
  }
  return posts as PlanPostRow[];
}

/** Serialise model rows to the 13-column QUOTE_ALL CSV. Columns 1-10 from the
 *  row (exact header keys), 11 = Sprigly notes, 12-13 always blank. */
function planRowsToCsv(rows: PlanPostRow[], contact: string): string {
  const out: string[][] = [planCsvHeader(contact)];
  for (const r of rows) {
    out.push([
      s(r.date), s(r.day), s(r.title), s(r.category), s(r.pillar), s(r.format),
      s(r.postingTime), s(r.whoPosts), s(r.competitorInsight), s(r.draftCaption), s(r.notes),
      '',  // {contact}'s Amended Caption — always blank
      '',  // {contact}'s Notes / Questions — always blank
    ]);
  }
  return csvQuoteAll(out);
}

// ── Prompt assembly ──────────────────────────────────────────────────────────────

/** "YYYY-MM" → the following month's "YYYY-MM" (rolls the year at December). */
export function nextMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1)); // m is 1-based, so index m == the next month
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabelOf(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

interface PlanningInputs {
  clientName: string;
  dataMonth:  string;            // YYYY-MM — the cycle's data month (sales / IG scrape / intake captured)
  targetMonth: string;          // YYYY-MM — the month being PLANNED (dataMonth + 1)
  answers:    Record<string, string>;
  freeNotes:  string;
  planConfig: ClientPlanningConfig | undefined;
  gather:     CompetitorGatherData | null;
  voiceMd:    string | null;
  catalogueGrounding: string;   // SOFT grounding: real products + colourways (may be '')
}

/** Build the single user message: every assembled input, clearly sectioned, for
 *  the system prompt (skill steps 5-8) to reason over in one call. The plan is
 *  for targetMonth (one month AHEAD), built from dataMonth's intake and data. */
function buildPlanningUserMessage(inp: PlanningInputs): string {
  const answerLines = Object.entries(inp.answers)
    .filter(([, v]) => v.trim().length > 0)
    .map(([q, a]) => `- ${q}\n  ${a.trim()}`)
    .join('\n');

  const cfg = inp.planConfig;
  const competitorSection = inp.gather
    ? `COMPETITOR DATA (deterministic gather — cite specific accounts and numbers):\n${JSON.stringify(inp.gather, null, 2)}`
    : 'COMPETITOR DATA: none available this cycle. Balance pillars only. In every Competitor Insight write "No competitor data this cycle." plus a short pillar/format rationale. Do NOT invent competitor names, numbers, or multipliers.';

  return [
    `CLIENT: ${inp.clientName}`,
    `PLAN MONTH (plan FOR this month; every date must fall in it): ${monthLabelOf(inp.targetMonth)} (${inp.targetMonth})`,
    `DATA MONTH (the current month the intake and any data are from; you are planning the month AFTER it): ${monthLabelOf(inp.dataMonth)} (${inp.dataMonth})`,
    '',
    'INTAKE — the client\'s planning answers for the PLAN MONTH (your PRIMARY signal; plan that month around this):',
    answerLines || '(no structured answers provided)',
    inp.freeNotes ? `\nFREE NOTES:\n${inp.freeNotes}` : '',
    '',
    'PLANNING CONFIG:',
    `Pillars (use these names verbatim; assign exactly one per post):\n${JSON.stringify(cfg?.pillars ?? [], null, 2)}`,
    `Cadence: ${JSON.stringify(cfg?.cadence ?? {})}`,
    `Recurring series (schedule each on its day/time/format/whoPosts):\n${JSON.stringify(cfg?.recurringSeries ?? [], null, 2)}`,
    `Posting times (use these labels): ${JSON.stringify(cfg?.postingTimes ?? {})}`,
    `Categories (AUTHORITATIVE — use ONLY these values for the category field): ${JSON.stringify(cfg?.categories ?? [])}`,
    '',
    competitorSection,
    '',
    inp.catalogueGrounding
      ? `PRODUCTS — this client's REAL products and their ACTUAL colourways. Use ONLY products and colourways from this list. NEVER invent a product name or a colourway, and NEVER pair a product with a colourway not listed under it. If the intake needs a product not here, describe it generically without naming a colourway.\n${inp.catalogueGrounding}`
      : 'PRODUCTS: no catalogue available — refer to products only as the intake names them; do not invent product names or colourways.',
    '',
    'VOICE (voice.md — apply to every caption):',
    inp.voiceMd ?? '(voice.md not available — apply the hard caption rules in the system prompt and keep captions plain and on-brand.)',
    '',
    `Produce the plan for ${monthLabelOf(inp.targetMonth)} now. Every "date" field must be a real date IN ${monthLabelOf(inp.targetMonth)}. Output the JSON object specified, JSON only.`,
  ].filter((l) => l !== '').join('\n');
}

// ── Critic reference loaders (per-client, both optional → degrade gracefully) ──

/** Parse an IG-scrape JSON array. Strict first; falls back to a tolerant pass for
 *  raw Apify exports that contain literal newlines inside caption strings. */
function parseScrapeJson(text: string): Array<Record<string, unknown>> {
  try {
    const j = JSON.parse(text) as unknown;
    if (Array.isArray(j)) return j as Array<Record<string, unknown>>;
  } catch { /* fall through to tolerant parse */ }
  let out = ''; let inStr = false; let esc = false;
  for (const ch of text) {
    if (esc) { out += ch; esc = false; }
    else if (ch === '\\' && inStr) { out += ch; esc = true; }
    else if (ch === '"') { out += ch; inStr = !inStr; }
    else if (inStr && ch === '\n') out += '\\n';
    else if (inStr && ch === '\r') out += '\\r';
    else if (inStr && ch === '\t') out += '\\t';
    else out += ch;
  }
  const j = JSON.parse(out) as unknown;
  return Array.isArray(j) ? (j as Array<Record<string, unknown>>) : [];
}

/** Load this client's historic published posts (IG scrape) from Drive as the
 *  critic's voice reference. Absent file → []. Never throws. */
async function loadHistoricPosts(
  drive:       DriveApiClient,
  folderFiles: DriveFileMeta[],
  logger:      Logger,
  logCtx:      Record<string, unknown>,
): Promise<HistoricPost[]> {
  const scrapeFiles = folderFiles
    .filter((f) => /^instagram-posts-.*\.json$/i.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name))   // most-recent month first
    .slice(0, 2);
  const posts: HistoricPost[] = [];
  for (const meta of scrapeFiles) {
    try {
      const arr = parseScrapeJson((await drive.downloadFile(meta.id)).toString('utf-8'));
      for (const p of arr) {
        const caption = typeof p['caption'] === 'string' ? (p['caption'] as string).trim() : '';
        if (!caption) continue;
        posts.push({ caption, engagement: (Number(p['likesCount']) || 0) + (Number(p['commentsCount']) || 0) });
      }
    } catch (err) {
      logger.warn({ ...logCtx, file: meta.name, err: String(err) }, 'critic: could not read IG scrape — skipping');
    }
  }
  return posts.slice(0, 60);
}

/** Load this client's substantive caption corrections from voice_edits:
 *  contact_amended present, > 30 chars, actually different from the draft; deduped. */
async function loadVoiceEdits(db: Db, clientId: string, channel: string): Promise<VoiceEditExample[]> {
  const rows = await db
    .select({ sprigly: voiceEdits.spriglyDraft, amended: voiceEdits.contactAmended })
    .from(voiceEdits)
    .where(and(
      eq(voiceEdits.clientId, clientId),
      eq(voiceEdits.channel, channel),
      isNotNull(voiceEdits.contactAmended),
    ))
    .orderBy(desc(voiceEdits.updatedAt))
    .limit(40);

  const seen = new Set<string>();
  const out: VoiceEditExample[] = [];
  for (const r of rows) {
    const amended = (r.amended ?? '').trim();
    const sprigly = (r.sprigly ?? '').trim();
    if (amended.length <= 30 || amended === sprigly || seen.has(amended)) continue;
    seen.add(amended);
    out.push({ sprigly, amended });
    if (out.length >= 6) break;
  }
  return out;
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
  // You plan the month AHEAD: the cycle's data month (cycleMonth) drives NEXT
  // month's plan. cycleMonth stays the data month (Option a — no migration);
  // the plan, its dates, and the CSV/xlsx filename all target cycleMonth + 1.
  const targetMonth = nextMonth(cycleMonth);
  const logCtx = { cycleId, clientId, channel, dataMonth: cycleMonth, targetMonth };

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

    const [catRow] = await db
      .select({ catalogue: clientProductCatalogue.catalogue })
      .from(clientProductCatalogue)
      .where(and(
        eq(clientProductCatalogue.clientId, clientId),
        eq(clientProductCatalogue.channel,  channel),
      ))
      .limit(1);
    const catalogue = (catRow?.catalogue as Catalogue | undefined) ?? null;
    const intakeText = [freeNotes, ...Object.values(answers)].join('\n');
    const catalogueGrounding = catalogue ? buildCatalogueGroundingBlock(catalogue, intakeText) : '';

    const [clientRow] = await db
      .select({ name: clients.name, slug: clients.slug })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    const slug       = clientRow?.slug ?? 'client';
    const clientName = clientRow?.name ?? slug;

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

    // ── Generate the plan: single pre-assembled Bedrock call ──────────────────
    const systemPrompt = await deps.prompts.resolve(clientId, PLANNING_WORKFLOW, PLANNING_STEP);
    const userMessage  = buildPlanningUserMessage({
      clientName, dataMonth: cycleMonth, targetMonth, answers, freeNotes,
      planConfig: planConfigRow, gather, voiceMd, catalogueGrounding,
    });

    // Streaming, NOT complete(): this is the platform's largest call (rich voice.md
    // + full-month plan, up to 16k output tokens). complete() has a hard 180s
    // wall-clock abort that this call exceeds; completeStreaming() aborts only on a
    // 30s idle gap, so a long generation finishes as long as tokens keep flowing.
    const result = await deps.model.completeStreaming({
      model:     PLANNING_MODEL,
      system:    systemPrompt,
      messages:  [{ role: 'user', content: userMessage }],
      maxTokens: PLANNING_MAX_TOKENS,
    });

    // Audit the platform's biggest model call — non-fatal (plan is already generated).
    try {
      await deps.audit.logModelCall({
        clientId,
        modelId:      result.modelId,
        inputTokens:  result.inputTokens,
        outputTokens: result.outputTokens,
        action:       'content-cycle:planning',
        metadata:     { channel, dataMonth: cycleMonth, targetMonth, gatherPresent: gather !== null, voicePresent: voiceMd !== null },
      });
    } catch (auditErr) {
      logger.warn({ ...logCtx, err: String(auditErr) }, 'content-cycles: planning audit log failed — non-fatal');
    }

    const generatedRows = parsePlanResponse(result.content);

    logger.info(
      { ...logCtx, posts: generatedRows.length, inputTokens: result.inputTokens, outputTokens: result.outputTokens, modelId: result.modelId },
      'content-cycles: plan generated',
    );

    // ── Validation loop ───────────────────────────────────────────────────────
    const vocab = {
      categories: planConfigRow?.categories ?? [],
      pillars:    (planConfigRow?.pillars ?? [])
        .map((p) => (p as { name?: unknown }).name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0),
    };
    const repairCtx: PlanRepairContext = {
      vocab, model: deps.model, modelName: PLANNING_MODEL, audit: deps.audit,
      systemPrompt, userMessage, clientId, logger, logMeta: logCtx,
    };

    // STAGE 1 — code gate (universal mechanical, per-post): instruction-leak /
    // em-dash / empty / invalid category-pillar. Regenerates failures, max 3.
    const gate = await applyCodeGate(generatedRows, repairCtx);
    logger.info(
      { ...logCtx, checked: gate.checked, repaired: gate.repaired, acceptedWithWarning: gate.acceptedWithWarning.length },
      'content-cycles: code gate complete',
    );

    // STAGE 2 — LLM critic (client-specific): judges voice/sign-off/pillar-voice
    // and the clientWritesOwn flag against THIS client's voice.md + config +
    // historic posts + corrections. Runs only on gate-passing posts.
    const criticPrompt  = await deps.prompts.resolve(clientId, PLANNING_WORKFLOW, PLANNING_CRITIC_STEP);
    const historicPosts = await loadHistoricPosts(drive, folderFiles, logger, logCtx);
    const voiceEditEx    = await loadVoiceEdits(db, clientId, channel);
    if (historicPosts.length === 0) {
      logger.info(logCtx, 'critic: no historic reference — critic on voice.md only');
    }
    const critic = await applyCritic(gate.rows, {
      criticPrompt, voiceMd,
      planConfig:    { pillars: planConfigRow?.pillars ?? [], categories: planConfigRow?.categories ?? [] },
      historicPosts, voiceEdits: voiceEditEx,
      model: deps.model, modelName: PLANNING_MODEL, audit: deps.audit,
      clientId, logger, logMeta: logCtx, exampleCount: 4,
    }, repairCtx);
    logger.info(
      { ...logCtx, checked: critic.checked, regenerated: critic.regenerated, acceptedWithWarning: critic.acceptedWithWarning.length },
      'content-cycles: critic complete',
    );
    // ── Validation: HARD catalogue grounding (deterministic, runs LAST) ────────
    // Rewrite any product+colourway pairing that doesn't exist in the catalogue to
    // a neutral "[confirm colourway]" placeholder + a Sprigly Note (kills the
    // "Elle in dark olive" fabrication). Runs after the critic so the placeholder
    // isn't re-flagged by the code gate. Skipped when no catalogue is cached.
    let planRows = critic.rows;
    if (catalogue) {
      const idx = indexCatalogue(catalogue);
      let totalViolations = 0;
      planRows = critic.rows.map((p) => {
        const { caption, notes, violations } = applyCatalogueValidation(p.draftCaption ?? '', p.notes ?? '', idx);
        if (violations.length === 0) return p;
        totalViolations += violations.length;
        return { ...p, draftCaption: caption, notes: notes.join(' ') };
      });
      logger.info(
        { ...logCtx, catalogueViolations: totalViolations },
        totalViolations > 0
          ? 'content-cycles: catalogue validation rewrote invalid product/colourway pairings'
          : 'content-cycles: catalogue validation passed — all pairings valid',
      );
    } else {
      logger.info({ ...logCtx }, 'content-cycles: no product catalogue cached — hard validation skipped (soft grounding only)');
    }

    // ── Serialise to the 13-column CSV ────────────────────────────────────────
    // Filename targets the PLAN month (cycleMonth + 1), so build-workbook names
    // the xlsx for that month and the whole downstream chain stays consistent.
    const filename = `${targetMonth}_${slug}-instagram-plan.csv`;
    const csv      = planRowsToCsv(planRows, contact);
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
