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
 *   - voice profile           — the current DB voice snapshot (voice_snapshots.snapshot_md
 *                               where is_current = true, per client+channel); applied to every
 *                               caption and shared by plan/hook/script generation. The Drive
 *                               voice.md is now a write-only review artifact, NOT a generation input.
 *
 * The prompt lives in the store (workflowId='planning', stepName='generate-plan'),
 * UI-editable like lean-line. The call logs to the audit/cost ledger
 * (action 'content-cycle:planning') — the biggest model call in the platform.
 *
 * On error: → failed, failed_step='planning' (CSV not guaranteed; safe to retry).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { eq, and, or, desc, gt, gte, lte, isNull, isNotNull, inArray } from 'drizzle-orm';
import {
  db as _db,
  contentCycles,
  clientPlanningConfig,
  competitorGatherCache,
  clientChannels,
  clients,
  voiceEdits,
  voiceSnapshots,
  igPosts,
  appMagicLinkTokens,
  clientProductCatalogue,
  contentCyclePosts,
  postEdits,
  planInputs,
  stampPostsSyncStatus,
} from '@sprigly/db';
import type { NewContentCyclePostRow } from '@sprigly/db';
import { mapFormat, isoDateInMonth } from './post-mapping.js';
import type { ClientPlanningConfig } from '@sprigly/db';
import type { Catalogue } from '../catalogue/parse-catalogue.js';
import { indexCatalogue, applyCatalogueValidation, buildCatalogueGroundingBlock, deriveBrandTokens } from '../catalogue/validate-catalogue.js';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { DbPromptResolver } from '@sprigly/prompts';
import type { IntakeJson, CompetitorGatherData, StructuredBrief } from '@sprigly/engine';
import { deliverTemplatedEmail } from './email-send.js';
import type { Logger } from 'pino';
import { transitionCycle } from './machine.js';
import { applyCodeGate, applyCritic, normaliseDashes } from './plan-validation.js';
import { parsePlanResponse } from './parse-plan.js';
import { extractStructuredBrief, EMPTY_STRUCTURED_BRIEF } from './brief-extract.js';
import { mergePlan, dropCollidingInserts, briefedProductNames, type ExistingPost } from './plan-merge.js';
import type { RegisterMap } from './plan-validation.js';
import type { PlanPostRow, HistoricPost, VoiceEditExample, PlanRepairContext } from './plan-validation.js';
import { PlanningTracer } from './planning-trace.js';
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
  // App-surface delivery only: base URL for the /p/<token> magic link. Optional —
  // falls back to process.env.APP_BASE_URL. Unused by sheet/both and by the
  // shape/hook/script/weekly callers of assembleShapeContext.
  appBaseUrl?:        string;
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

// parsePlanResponse (tolerant generation-JSON parse + one repair pass) lives in
// ./parse-plan.ts so it is unit-testable without this module's DB/Drive/model graph.

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
  postsPerWeek: number | null;  // Phase 4 — explicit weekly cadence override; null = use config cadence
  structuredBrief: StructuredBrief | null;  // Phase 3b — authoritative parsed brief (may be null/empty)
}

/** Render the STRUCTURED BRIEF section: the parsed, concrete, authoritative form of
 *  the client's brief (products / dated schedule / undated content asks / window).
 *  Returned '' when there is nothing briefed, so the prompt is unchanged for cycles
 *  with no brief. conflicts[] is deliberately NOT rendered here — it is surfaced to
 *  the human reviewer on the plan output, not fed to the model as an instruction. */
function renderStructuredBriefSection(sb: StructuredBrief): string {
  const products = sb.products.map((p) => {
    const bits = [`${p.product}${p.colourway ? ` in ${p.colourway}` : ''} — ${p.status.toUpperCase()}`];
    if (p.launch_date) bits.push(`launches ${p.launch_date}`);
    if (p.content_from) bits.push(`content from ${p.content_from}`);
    return `  - ${bits.join('; ')}`;
  }).join('\n');
  const schedule = sb.schedule.map((b) => {
    const who = [b.product, b.colourway].filter(Boolean).join(' ');
    // Range beats render their resolved span (e.g. "2026-08-25 to 2026-08-31"); the note still
    // carries the client's original vague phrasing so the generator sees BOTH the concrete
    // window and the "last week of August" framing.
    const when = b.dateRange ? `${b.dateRange.start} to ${b.dateRange.end}` : b.date;
    return `  - ${when} (${b.type})${who ? ` — ${who}` : ''}: ${b.note}`;
  }).join('\n');
  const asks = sb.content_asks.map((a) => `  - ${a.type}${a.product ? ` (${a.product})` : ''}: ${a.note}`).join('\n');
  const pw = sb.plan_window;

  return [
    'STRUCTURED BRIEF (AUTHORITATIVE — the parsed, concrete form of the client brief. Where this and the free-text INTAKE below differ, THIS wins. Build the month from these items first):',
    pw.from || pw.month
      ? `PLAN WINDOW: ${pw.from ? `start content from ${pw.from}; ` : ''}${pw.month ? `every date must fall in ${pw.month}` : ''}. Place NOTHING${pw.from ? ` before ${pw.from}` : ''}.`
      : '',
    '',
    'BRIEFED LAUNCHES / RESTOCKS (the ONLY launches and restocks this month — feature these; do NOT frame any other product as launching, new, or returning):',
    products || '  (none)',
    '',
    'FIXED DATED BEATS (authoritative schedule — use THESE dates exactly; do not invent, shift, or de-collide dates. Two beats may legitimately share a date. A beat given as a range "X to Y" is a VAGUE window: place it on a sensible single day INSIDE that window, keeping the window\'s framing):',
    schedule || '  (none)',
    '',
    'UNDATED CONTENT PIECES (each MUST appear once somewhere in the month, on a sensible date inside the plan window — do NOT drop any):',
    asks || '  (none)',
  ].filter((l) => l !== '').join('\n');
}

/** True when a brief carries nothing to render (so the section is omitted). */
function hasBriefContent(sb: StructuredBrief | null): sb is StructuredBrief {
  return !!sb && (sb.products.length > 0 || sb.schedule.length > 0 || sb.content_asks.length > 0);
}

/**
 * Surface brief conflicts (Phase 3b) to the human plan reviewer: append a visible
 * "⚠️ Brief conflict" note to the Sprigly Notes of the post(s) on each conflicting
 * date (e.g. the 17 July double-booking, the 19/26 July weekday mismatches), falling
 * back to the first post for a conflict with no matching dated post. Deterministic,
 * post-generation, mutates row.notes in place. NOT auto-resolved and NOT hidden —
 * the reviewer decides. Returns the number of conflicts surfaced.
 */
function surfaceConflicts(rows: PlanPostRow[], brief: StructuredBrief | null, targetMonth: string): number {
  const conflicts = brief?.conflicts ?? [];
  if (conflicts.length === 0 || rows.length === 0) return 0;
  for (const c of conflicts) {
    const note = `⚠️ Brief conflict (please confirm): ${c.description}`;
    const dated = c.dates && c.dates.length > 0
      ? rows.filter((r) => { const iso = isoDateInMonth(r.date, targetMonth); return iso != null && c.dates!.includes(iso); })
      : [];
    const recipients = dated.length > 0 ? dated : [rows[0]!];
    for (const r of recipients) r.notes = r.notes ? `${r.notes} ${note}` : note;
  }
  return conflicts.length;
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
    hasBriefContent(inp.structuredBrief) ? renderStructuredBriefSection(inp.structuredBrief) : '',
    hasBriefContent(inp.structuredBrief)
      ? 'INTAKE (the original free-text brief, for context and voice — the STRUCTURED BRIEF above is its authoritative concrete form and wins on any difference):'
      : 'INTAKE — the client\'s planning answers for the PLAN MONTH (your PRIMARY signal; plan that month around this):',
    answerLines || '(no structured answers provided)',
    inp.freeNotes ? `\nFREE NOTES:\n${inp.freeNotes}` : '',
    '',
    'PLANNING CONFIG:',
    `Pillars (use these names verbatim; assign exactly one per post):\n${JSON.stringify(cfg?.pillars ?? [], null, 2)}`,
    `Cadence: ${JSON.stringify(cfg?.cadence ?? {})}`,
    inp.postsPerWeek != null
      ? `TARGET CADENCE (AUTHORITATIVE — overrides the cadence range above): plan exactly ${inp.postsPerWeek} posts per week across the plan month, distributed evenly on the standard posting days/times.`
      : '',
    `Recurring series (schedule each on its day/time/format/whoPosts):\n${JSON.stringify(cfg?.recurringSeries ?? [], null, 2)}`,
    `Posting times (use these labels): ${JSON.stringify(cfg?.postingTimes ?? {})}`,
    `Categories (AUTHORITATIVE — use ONLY these values for the category field): ${JSON.stringify(cfg?.categories ?? [])}`,
    '',
    competitorSection,
    '',
    inp.catalogueGrounding
      ? [
          "PRODUCTS — this client's REAL products. Each line lists the ONLY colourways that exist for THAT product.",
          'This is NOT a shared palette. A colourway listed under one product does NOT exist for any other product: "Dark Olive" under Hannah does not mean Nicola comes in dark olive. Each colourway belongs only to the product it is listed under.',
          "ANTI-BLEED: a hero piece's colourway never transfers to the other pieces in the same outfit. If you style Nicola in vintage navy with a Claire skirt, that does NOT make the Claire \"vintage navy\" — give Claire one of CLAIRE's own colourways, or none.",
          'OMIT WHEN UNSURE (this is the main rule): when you name a product you may either (a) give it one of ITS OWN listed colourways, or (b) name it with NO colourway at all. A product named WITHOUT a colourway is always valid ("Nicola" is fine); a product named with a colourway it does not have is a fabrication ("Nicola in dark olive" is not). When in any doubt, OMIT the colourway — say less, never wrong.',
          'OUTFIT / STYLING BLOCKS: name the LEAD / hero piece WITH its colourway. Name the SUPPORTING pieces WITHOUT a colourway, unless you are deliberately using one of that specific product\'s own listed colourways. This matches how the client writes — the hero piece is coloured, the supporting pieces are lighter.',
          'If you need a product not in this list, describe it generically and name no colourway. NEVER invent a product name.',
          '',
          inp.catalogueGrounding,
        ].join('\n')
      : 'PRODUCTS: no catalogue available — refer to products only as the intake names them; do not invent product names or colourways, and name no colourway you are unsure of.',
    '',
    'VOICE (voice.md — apply to every caption):',
    inp.voiceMd ?? '(voice.md not available — apply the hard caption rules in the system prompt and keep captions plain and on-brand.)',
    '',
    `Produce the plan for ${monthLabelOf(inp.targetMonth)} now. Every "date" field must be a real date IN ${monthLabelOf(inp.targetMonth)}. Output the JSON object specified, JSON only.`,
  ].filter((l) => l !== '').join('\n');
}

// ── Critic reference loaders (per-client, both optional → degrade gracefully) ──

/** Load this client's historic published posts (IG scrape) from the ig_posts DB
 *  table (re-homed off Drive) as the critic's voice reference: the two most-recent
 *  months by month key. No rows → []. Never throws. */
async function loadHistoricPosts(
  db:       Db,
  clientId: string,
  channel:  string,
  logger:   Logger,
  logCtx:   Record<string, unknown>,
): Promise<HistoricPost[]> {
  const posts: HistoricPost[] = [];
  try {
    const rows = await db
      .select({ posts: igPosts.posts })
      .from(igPosts)
      .where(and(eq(igPosts.clientId, clientId), eq(igPosts.channel, channel)))
      .orderBy(desc(igPosts.month))   // 'YYYY-MM' sorts chronologically — most-recent month first
      .limit(2);
    for (const row of rows) {
      const arr = Array.isArray(row.posts) ? row.posts : [];
      for (const p of arr) {
        const caption = typeof p['caption'] === 'string' ? (p['caption'] as string).trim() : '';
        if (!caption) continue;
        posts.push({ caption, engagement: (Number(p['likesCount']) || 0) + (Number(p['commentsCount']) || 0) });
      }
    }
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'critic: could not read ig_posts — skipping');
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

/** Everything assembled from a cycle's inputs needed to generate or reshape its
 *  plan: the resolved prompts + user message, the validation vocab/critic context,
 *  catalogue, voice, and the Drive handles. Shared by planning (generation) and the
 *  Phase 3 shape handler (instructed rewrite), so both run the identical machinery. */
export interface ShapeContext {
  answers:            Record<string, string>;
  freeNotes:          string;
  planConfigRow:      ClientPlanningConfig | undefined;
  gather:             CompetitorGatherData | null;
  catalogue:          Catalogue | null;
  catalogueGrounding: string;
  structuredBrief:    StructuredBrief | null;
  slug:               string;
  clientName:         string;
  contact:            string;
  deliverySurface:    string;                 // 'app' | 'sheet' | 'both' — drives the app Drive-free branch
  drive:              DriveApiClient | null;   // null for surface='app' (no Drive)
  driveFolderId:      string | null;           // null for surface='app'
  folderFiles:        DriveFileMeta[];          // [] for surface='app'
  voiceMd:            string | null;
  systemPrompt:       string;
  userMessage:        string;
  vocab:              { categories: string[]; pillars: string[] };
  criticPrompt:       string;
  historicPosts:      HistoricPost[];
  voiceEdits:         VoiceEditExample[];
}

/**
 * Assemble all planning inputs for a cycle: load config / gather / catalogue /
 * client / channel / Drive folder, read the voice profile from the current DB
 * voice snapshot (voice_snapshots.snapshot_md, is_current = true — NOT a Drive
 * voice.md download), resolve the generate + critic prompts, build the user
 * message, and load the critic's historic posts + voice edits. The assembled
 * voiceMd is shared by plan/hook/script generation. PURE READS — no Bedrock,
 * no writes — so it is safe to share between
 * planning's generation and the shape handler. The plan output is determined
 * solely by `systemPrompt` + `userMessage`, both built here exactly as before.
 */
export async function assembleShapeContext(
  cycle: typeof contentCycles.$inferSelect,
  deps:  PlanningDeps,
): Promise<ShapeContext> {
  const { db, encProvider, googleClientId, googleClientSecret, logger } = deps;
  const { clientId, channel, cycleMonth } = cycle;
  const targetMonth = nextMonth(cycleMonth);
  const logCtx = { cycleId: cycle.id, clientId, channel, dataMonth: cycleMonth, targetMonth };

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
  // Structured brief (0058) — read off the cycle row (mapped column). Null until
  // extraction-persistence is wired, so grounding + validation degrade to prior
  // behaviour. NOTE: 0058 must be applied before this deploys — the mapped column
  // means select().from(contentCycles) references structured_brief.
  const structuredBrief = (cycle.structuredBrief ?? null) as StructuredBrief | null;
  const catalogueGrounding = catalogue ? buildCatalogueGroundingBlock(catalogue, intakeText, structuredBrief) : '';

  const [clientRow] = await db
    .select({ name: clients.name, slug: clients.slug })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const slug       = clientRow?.slug ?? 'client';
  const clientName = clientRow?.name ?? slug;

  const [channelRow] = await db
    .select({ driveFolderId: clientChannels.driveFolderId, contactName: clientChannels.contactName, postsPerWeek: clientChannels.postsPerWeek, deliverySurface: clientChannels.deliverySurface })
    .from(clientChannels)
    .where(and(
      eq(clientChannels.clientId, clientId),
      eq(clientChannels.channel,  channel),
    ))
    .limit(1);

  const driveFolderId  = channelRow?.driveFolderId ?? null;
  const contact        = (channelRow?.contactName ?? '').trim() || 'the client';
  const deliverySurface = channelRow?.deliverySurface ?? 'both';
  const isApp          = deliverySurface === 'app';

  // Drive is required for the CSV handoff on the sheet/both surfaces — without it the
  // xlsx can't be delivered. For surface='app' there is NO CSV/xlsx: voice, IG posts,
  // and the plan all live in the DB, so generation needs no Drive tokens or folder.
  let drive: DriveApiClient | null = null;
  let folderFiles: DriveFileMeta[] = [];
  if (!isApp) {
    const tokens = await getTokens(db, encProvider, clientId, 'drive');
    if (!tokens) throw new Error(`assembleShapeContext: no Drive tokens for client ${clientId}`);
    if (!driveFolderId) throw new Error(`assembleShapeContext: no drive_folder_id for ${clientId}/${channel}`);
    drive = new DriveApiClient(
      googleClientId, googleClientSecret, tokens,
      (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
    );
    folderFiles = await drive.listFiles(driveFolderId);
  }

  // Voice profile — read from the DB (voice_snapshots.snapshot_md, is_current row
  // keyed by client + channel), NOT the Drive voice.md. voice_snapshots is the
  // source of truth the voice-merge writes from, so this removes the Drive
  // round-trip from generation. Consumed by the prompt + critic in Stage 2.
  // Fail-safe preserved exactly: no current snapshot → voiceMd stays null and
  // generation continues on the generic voice fallback (same as a missing Drive
  // file today). Never throws.
  let voiceMd: string | null = null;
  try {
    const [voiceRow] = await db
      .select({ snapshotMd: voiceSnapshots.snapshotMd })
      .from(voiceSnapshots)
      .where(and(
        eq(voiceSnapshots.clientId,  clientId),
        eq(voiceSnapshots.channel,   channel),
        eq(voiceSnapshots.isCurrent, true),
      ))
      .limit(1);
    voiceMd = voiceRow?.snapshotMd ?? null;
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) }, 'content-cycles: planning could not read current voice snapshot — continuing without');
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

  // ── Resolve prompts + build the user message (the plan-determining inputs) ──
  const systemPrompt = await deps.prompts.resolve(clientId, PLANNING_WORKFLOW, PLANNING_STEP);
  const userMessage  = buildPlanningUserMessage({
    clientName, dataMonth: cycleMonth, targetMonth, answers, freeNotes,
    planConfig: planConfigRow, gather, voiceMd, catalogueGrounding,
    postsPerWeek: channelRow?.postsPerWeek ?? null,
    structuredBrief,
  });

  const vocab = {
    categories: planConfigRow?.categories ?? [],
    pillars:    (planConfigRow?.pillars ?? [])
      .map((p) => (p as { name?: unknown }).name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0),
  };

  // ── Critic context (client voice / register / historic posts) ─────────────
  const criticPrompt  = await deps.prompts.resolve(clientId, PLANNING_WORKFLOW, PLANNING_CRITIC_STEP);
  const historicPosts = await loadHistoricPosts(db, clientId, channel, logger, logCtx);
  const voiceEditEx   = await loadVoiceEdits(db, clientId, channel);
  if (historicPosts.length === 0) {
    logger.info(logCtx, 'critic: no historic reference — critic on voice.md only');
  }

  return {
    answers, freeNotes, planConfigRow, gather, catalogue, catalogueGrounding, structuredBrief,
    slug, clientName, contact, deliverySurface, drive, driveFolderId, folderFiles, voiceMd,
    systemPrompt, userMessage, vocab, criticPrompt, historicPosts, voiceEdits: voiceEditEx,
  };
}

// ── App-surface delivery helpers (Drive-free path) ────────────────────────────

/**
 * Ensure a per-cycle app magic link exists, IDEMPOTENTLY: reuse a live (non-revoked,
 * unexpired) token for this cycle if one exists, else mint one. Returns the /p/<token>
 * URL, or null if APP_BASE_URL is unset or the DB op fails (non-fatal — logged).
 * A regen re-run reuses the existing token (no duplicate mint).
 */
export async function ensureAppLink(
  db:        Db,
  clientId:  string,
  cycleId:   string,
  appBaseUrl: string,
  logger:    Logger,
): Promise<string | null> {
  const base = (appBaseUrl ?? '').replace(/\/$/, '');
  if (!base) {
    logger.warn({ clientId, cycleId }, 'content-cycles: APP_BASE_URL unset — cannot build app link');
    return null;
  }
  try {
    const [existing] = await db
      .select({ token: appMagicLinkTokens.token })
      .from(appMagicLinkTokens)
      .where(and(
        eq(appMagicLinkTokens.clientId, clientId),
        eq(appMagicLinkTokens.cycleId,  cycleId),
        isNull(appMagicLinkTokens.revokedAt),
        gt(appMagicLinkTokens.expiresAt, new Date()),
      ))
      .orderBy(desc(appMagicLinkTokens.createdAt))
      .limit(1);
    if (existing) {
      const appUrl = `${base}/p/${existing.token}`;
      logger.info({ clientId, cycleId, appUrl }, 'content-cycles: app magic link (reused existing)');
      return appUrl;
    }

    const token = randomBytes(32).toString('base64url');
    await db.insert(appMagicLinkTokens).values({
      clientId, cycleId, token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),  // 30 days
    });
    const appUrl = `${base}/p/${token}`;
    logger.info({ clientId, cycleId, appUrl }, 'content-cycles: app magic link minted');
    return appUrl;
  } catch (err) {
    logger.warn({ clientId, cycleId, err: String(err) }, 'content-cycles: ensureAppLink failed (non-fatal)');
    return null;
  }
}

/**
 * Send the app-surface "plan ready" notification as a LINK-ONLY email, PINNED to the test
 * inbox, with the client's Gmail tokens — now rendered from the PUBLISHED 'plan_ready' email
 * template (migration 0077) rather than hardcoded copy, so all four intake-capture emails
 * live in one system. Output is byte-equivalent to the previous hardcoded copy for the same
 * inputs (snapshot-tested). Best-effort: a failure is logged inside deliverTemplatedEmail and
 * never fails the cycle. {{appUrl}} became {{appLink}} in the template — same rendered URL.
 */
async function sendAppReadyNotification(
  deps:      PlanningDeps,
  clientId:  string,
  clientName: string,
  monthLabel: string,
  appUrl:    string,
): Promise<void> {
  await deliverTemplatedEmail(
    { db: deps.db, encProvider: deps.encProvider, googleClientId: deps.googleClientId, googleClientSecret: deps.googleClientSecret, logger: deps.logger },
    { key: 'plan_ready', clientId, merge: { clientName, monthLabel, appLink: appUrl } },
  );
}

/**
 * Live durable cross-cycle context for a client: active plan_inputs of type idea|next_cycle
 * whose relevance window overlaps the plan month (null bounds are open). Read at extraction
 * time so the latest standing notes are always current. Best-effort — a failure yields [].
 */
async function loadDurableContext(db: Db, clientId: string, planMonth: string): Promise<string[]> {
  const monthStart = `${planMonth}-01`;
  const monthEnd   = `${planMonth}-31`;   // lexical upper bound for the month
  try {
    const rows = await db
      .select({ type: planInputs.type, content: planInputs.content })
      .from(planInputs)
      .where(and(
        eq(planInputs.clientId, clientId),
        inArray(planInputs.type, ['idea', 'next_cycle']),
        eq(planInputs.status, 'active'),
        or(isNull(planInputs.relevantFrom), lte(planInputs.relevantFrom, monthEnd)),
        or(isNull(planInputs.relevantTo),   gte(planInputs.relevantTo,   monthStart)),
      ));
    return rows.map((r) => `[${r.type}] ${r.content}`);
  } catch {
    return [];
  }
}

/**
 * Extract-once persistence of the structured brief (Phase 3a). If the cycle already
 * has a persisted structured_brief, re-read it — no extraction (regen is cheap and
 * stable). Otherwise extract from intake_json.planContent (+ live durable context), persist
 * it, and return it. An EMPTY brief with no durable context extracts to the empty structure
 * with NO model call and is still persisted so it is not re-extracted. Never blocks planning:
 * an extraction or persist failure logs and falls back to the empty structure in memory (NOT
 * persisted, so a later run retries). Reading/writing structured_brief requires migration 0058.
 *
 * RE-EXTRACTION CORRECTNESS: an intake change clears structured_brief (Build 1 helper), which
 * is the ONLY re-extraction trigger; durable context is queried LIVE here, so whenever a
 * re-extraction runs both sources are current. (Adding a durable item alone does not force a
 * re-extraction — it is picked up at the next intake-triggered extraction or first generation.)
 */
async function ensureStructuredBrief(
  cycle: typeof contentCycles.$inferSelect,
  deps:  PlanningDeps,
): Promise<StructuredBrief> {
  const existing = cycle.structuredBrief;
  if (existing != null) return existing as StructuredBrief;   // extract-once: re-read on regen

  const intake      = cycle.intakeJson as IntakeJson | null;
  const planContent = intake?.planContent ?? { answers: {}, freeNotes: '' };
  const planMonth   = nextMonth(cycle.cycleMonth);
  const logCtx      = { cycleId: cycle.id, clientId: cycle.clientId, channel: cycle.channel };
  // Durable cross-cycle context (plan_inputs idea|next_cycle), read LIVE here so the latest
  // standing notes are current at extraction (Build 3, Part B — closes the businessContext gap).
  const durableContext = await loadDurableContext(deps.db, cycle.clientId, planMonth);

  let brief: StructuredBrief;
  try {
    brief = await extractStructuredBrief({
      planContent, planMonth, model: deps.model,
      logger: deps.logger, audit: deps.audit, clientId: cycle.clientId,
      durableContext,
    });
  } catch (err) {
    deps.logger.warn({ ...logCtx, err: String(err) }, 'content-cycles: brief extraction failed — planning continues without a structured brief (retries next run)');
    return EMPTY_STRUCTURED_BRIEF;   // in-memory only; NOT persisted, so a later run retries
  }

  try {
    await deps.db
      .update(contentCycles)
      .set({ structuredBrief: brief, updatedAt: new Date() })
      .where(eq(contentCycles.id, cycle.id));
    deps.logger.info(
      { ...logCtx, products: brief.products.length, schedule: brief.schedule.length, contentAsks: brief.content_asks.length },
      'content-cycles: structured brief extracted + persisted',
    );
  } catch (err) {
    deps.logger.warn({ ...logCtx, err: String(err) }, 'content-cycles: structured brief persist failed — non-fatal (used in memory this run)');
  }
  return brief;
}

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
  // A stable id for THIS write run — recorded on a verified 'synced' so the flag is
  // attributable to one commit, and carried on the failure stamp for correlation.
  const writeRunId = randomUUID();
  const logCtx = { cycleId, clientId, channel, dataMonth: cycleMonth, targetMonth, writeRunId };
  // Guards gap (c): only a verified posts-write may leave the flag 'synced'. Until
  // the posts stage RESOLVES (verified synced, or explicitly stamped out_of_sync),
  // any throw must NOT leave a stale 'synced' — the outer catch downgrades to
  // 'unknown'. postsWriteFailStamped keeps a precise out_of_sync from being
  // overwritten by 'unknown' if a LATER (CSV/transition) step then fails.
  let postsVerifiedSynced  = false;
  let postsWriteFailStamped = false;

  if (status !== 'intake_confirmed') {
    logger.info({ ...logCtx, status }, 'content-cycles: planning skipped — cycle not in intake_confirmed');
    return;
  }

  try {
    // ── Phase 3a: extract-once structured-brief persistence ───────────────────
    // Ensure structured_brief is populated (extract + persist on first plan, re-read
    // on regen), assigned back onto the in-memory cycle so the grounding + hard
    // validation built in assembleShapeContext consume it. Never blocks planning.
    cycle.structuredBrief = await ensureStructuredBrief(cycle, deps);

    // ── Assemble all inputs (shared with the Phase 3 shape handler) ───────────
    // Pure reads + prompt resolution. The plan is determined by systemPrompt +
    // userMessage, both built inside assembleShapeContext.
    const {
      planConfigRow, gather, catalogue, structuredBrief, slug, clientName, contact,
      deliverySurface, drive, driveFolderId,
      folderFiles, voiceMd, systemPrompt, userMessage, vocab, criticPrompt,
      historicPosts, voiceEdits,
    } = await assembleShapeContext(cycle, deps);

    // ── Generate the plan: single pre-assembled Bedrock call ──────────────────

    // Streaming, NOT complete(): this is the platform's largest call (rich voice.md
    // + full-month plan, up to 16k output tokens). complete() has a hard 180s
    // wall-clock abort that this call exceeds; completeStreaming() aborts only on a
    // 30s idle gap, so a long generation finishes as long as tokens keep flowing.
    //
    // ONE re-ask on unparseable output. The plan JSON is ~10k+ tokens; a single
    // stray char occasionally makes it unparseable (parsePlanResponse already
    // repairs the common cases). Generation is non-deterministic, so re-asking
    // once almost always yields clean JSON — far better than failing a whole cycle
    // on one bad character. Only after BOTH attempts fail does the cycle fail.
    const MAX_GEN_ATTEMPTS = 2;
    let generatedRows: PlanPostRow[] | null = null;
    let genMeta: { inputTokens: number; outputTokens: number; modelId: string } | null = null;
    let lastParseErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_GEN_ATTEMPTS; attempt++) {
      const result = await deps.model.completeStreaming({
        model:     PLANNING_MODEL,
        system:    systemPrompt,
        messages:  [{ role: 'user', content: userMessage }],
        maxTokens: PLANNING_MAX_TOKENS,
      });

      // Audit each call — non-fatal (a re-ask is a second billable call, hence attempt).
      try {
        await deps.audit.logModelCall({
          clientId,
          modelId:      result.modelId,
          inputTokens:  result.inputTokens,
          outputTokens: result.outputTokens,
          action:       'content-cycle:planning',
          metadata:     { channel, dataMonth: cycleMonth, targetMonth, gatherPresent: gather !== null, voicePresent: voiceMd !== null, attempt },
        });
      } catch (auditErr) {
        logger.warn({ ...logCtx, err: String(auditErr) }, 'content-cycles: planning audit log failed — non-fatal');
      }

      try {
        generatedRows = parsePlanResponse(result.content);
        genMeta = { inputTokens: result.inputTokens, outputTokens: result.outputTokens, modelId: result.modelId };
        if (attempt > 1) {
          logger.info({ ...logCtx, attempt }, 'content-cycles: planning generation parsed on re-ask — recovered from unparseable output');
        }
        break;
      } catch (parseErr) {
        lastParseErr = parseErr;
        logger.warn(
          { ...logCtx, attempt, outputTokens: result.outputTokens, err: String(parseErr) },
          attempt < MAX_GEN_ATTEMPTS
            ? 'content-cycles: planning generation output unparseable (after repair) — re-asking the model once'
            : 'content-cycles: planning generation output unparseable after re-ask — failing the cycle',
        );
      }
    }
    if (!generatedRows) {
      throw lastParseErr instanceof Error ? lastParseErr : new Error('planning: generation output unparseable after re-ask');
    }

    // Deterministic em-dash strip BEFORE the gate. The trace showed 21/21 gate
    // repairs were em-dash-only LLM regenerations doing nothing but this swap
    // (~£0.84/run of marginal churn). Doing it here for free means the em-dash gate
    // should now almost never fire. Caption only (the only field the gate checks).
    let dashStripped = 0;
    for (const r of generatedRows) {
      if (!r.draftCaption) continue;
      const fixed = normaliseDashes(r.draftCaption);
      if (fixed !== r.draftCaption) { r.draftCaption = fixed; dashStripped++; }
    }

    logger.info(
      { ...logCtx, posts: generatedRows.length, dashStripped, inputTokens: genMeta?.inputTokens, outputTokens: genMeta?.outputTokens, modelId: genMeta?.modelId },
      'content-cycles: plan generated',
    );

    // ── Validation loop ───────────────────────────────────────────────────────
    // vocab + the critic context (criticPrompt / historicPosts / voiceEdits) come
    // from assembleShapeContext above.
    // Diagnostic trace: records every gate/critic/repair/catalogue step (caption
    // before→after, trigger, token cost) so a run can be judged after the fact.
    // Purely observational — buffered in memory, flushed once at the end, and a
    // trace-write failure never fails the run.
    const tracer = new PlanningTracer(cycleId, targetMonth, logger, logCtx);

    const repairCtx: PlanRepairContext = {
      vocab, model: deps.model, modelName: PLANNING_MODEL, audit: deps.audit,
      systemPrompt, userMessage, clientId, logger, logMeta: logCtx, tracer,
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
    const critic = await applyCritic(gate.rows, {
      criticPrompt, voiceMd,
      planConfig:    {
        pillars:     planConfigRow?.pillars ?? [],
        categories:  planConfigRow?.categories ?? [],
        registerMap: (planConfigRow?.registerMap ?? {}) as RegisterMap,
      },
      historicPosts, voiceEdits,
      model: deps.model, modelName: PLANNING_MODEL, audit: deps.audit,
      clientId, logger, logMeta: logCtx, exampleCount: 4, tracer,
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
    // Brand tokens (per-client — replaces the hardcoded 'ivy'): the client's own name
    // words, never matched as product names in catalogue grounding/merge. IVY-t → {ivy}.
    const brandTokens = deriveBrandTokens(clientName);
    let planRows = critic.rows;
    if (catalogue) {
      const idx = indexCatalogue(catalogue, structuredBrief, brandTokens);
      let totalViolations = 0;
      planRows = critic.rows.map((p, index) => {
        const before = p.draftCaption ?? '';
        const { caption, notes, violations } = applyCatalogueValidation(before, p.notes ?? '', idx);
        if (violations.length === 0) return p;
        totalViolations += violations.length;
        tracer.catalogue(index, p.title, before, caption, violations.map((v) => `${v.name} in ${v.colourway}`));
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

    // ── Surface brief conflicts to the reviewer (Phase 3b) ─────────────────────
    // Append ⚠️ notes on the affected dated posts (17 Jul double-booking, 19/26 Jul
    // weekday mismatches) so the reviewer sees them on the plan. Not auto-resolved.
    const conflictsSurfaced = surfaceConflicts(planRows, structuredBrief, targetMonth);
    if (conflictsSurfaced > 0) {
      logger.info({ ...logCtx, conflictsSurfaced }, 'content-cycles: surfaced brief conflicts to reviewer via post notes');
    }

    // ── Persist the diagnostic trace (best-effort; never fails the run) ────────
    // All loop phases are done — flush the buffered gate/critic/repair/catalogue
    // steps in one insert. Read back with `pnpm --filter @sprigly/worker planning-trace <cycleId>`.
    await tracer.flush(db);

    // ── Write content_cycle_posts — EDIT-AWARE MERGE (edits win, rest replaced) ─
    // The client app reads/edits this table. A blind delete-all→insert (the old
    // behaviour) hit the post_edits → content_cycle_posts FK and silently rolled
    // back, leaving the app stale. Instead: classify existing posts, DELETE only the
    // un-edited + empty-placeholder rows (all post_edits-free by construction), KEEP
    // the client's edited/authored posts (flagged for review), and INSERT the new
    // plan as review_state='regenerated'. Fail-loud: a write failure is logged at
    // ERROR and flags the cycle out_of_sync (the workbook/CSV path is unaffected) —
    // never silently swallowed.
    try {
      let postRows: NewContentCyclePostRow[] = [];
      for (let i = 0; i < planRows.length; i++) {
        const p  = planRows[i]!;
        const iso = isoDateInMonth(p.date, targetMonth);
        if (!iso) continue;   // undated row (shouldn't happen) — skip rather than guess
        postRows.push({
          cycleId, clientId, channel,
          scheduledDate: iso,
          format:        mapFormat(p.format),
          pillar:        p.pillar ?? null,
          caption:       p.draftCaption ?? null,
          status:        'planned',
          reviewState:   'regenerated',
          position:      i,
          sourceMeta: {
            title:             p.title ?? '',
            category:          p.category ?? '',
            postingTime:       p.postingTime ?? '',
            whoPosts:          p.whoPosts ?? '',
            competitorInsight: p.competitorInsight ?? '',
            notes:             p.notes ?? '',
            clientWritesOwn:   p.clientWritesOwn === true,
            day:               p.day ?? '',
            // Original as-generated values, so the app's "revert" can restore them.
            original: {
              caption:       p.draftCaption ?? '',
              format:        mapFormat(p.format),
              pillar:        p.pillar ?? '',
              scheduledDate: iso,
              position:      i,
            },
          },
        });
      }

      // Classify the cycle's existing posts (explicit columns — never select-all, so
      // this is safe before/after the review_state column is applied).
      const existingRows = await db
        .select({
          id: contentCyclePosts.id, scheduledDate: contentCyclePosts.scheduledDate,
          status: contentCyclePosts.status, caption: contentCyclePosts.caption,
          sourceMeta: contentCyclePosts.sourceMeta,
        })
        .from(contentCyclePosts)
        .where(eq(contentCyclePosts.cycleId, cycleId));
      const editRefs = await db.select({ postId: postEdits.postId }).from(postEdits).where(eq(postEdits.cycleId, cycleId));
      const editedIds = new Set(editRefs.map((r) => r.postId));
      const catalogueNames = (catalogue?.families ?? [])
        .map((f) => f.name.toLowerCase().trim())
        .filter((n) => n && !brandTokens.has(n));
      const existing: ExistingPost[] = existingRows.map((r) => ({
        id: r.id, scheduledDate: r.scheduledDate, status: r.status, caption: r.caption,
        title: ((r.sourceMeta as Record<string, unknown> | null)?.['title'] as string) ?? '',
        hasPostEdit: editedIds.has(r.id),
      }));
      const dec = mergePlan({ existing, briefedProducts: briefedProductNames(structuredBrief, catalogueNames), catalogueNames });
      const deleteIds = [...dec.drop, ...dec.replace].map((d) => d.post.id);

      // Slot-awareness (recurrence fix for same-date duplicates): preserved edits OWN
      // their dates. Drop any incoming regenerated post whose date collides with a
      // preserved row before insert, so the regen never double-books a kept edit — it
      // fills only the dates the client did not preserve. Log each drop.
      {
        const { kept, dropped } = dropCollidingInserts(postRows, dec.preserve);
        for (const r of dropped) {
          logger.info(
            { ...logCtx, date: r.scheduledDate, title: (r.sourceMeta as { title?: string } | null)?.title ?? '' },
            'content-cycles: slot-aware merge dropped an incoming post — date owned by a preserved edit',
          );
        }
        postRows = kept;
      }

      // Gap (a): a plan was generated but yielded ZERO writable posts (e.g. every date
      // fell outside targetMonth, or every date is already owned by a preserved edit).
      // That is a FAILURE, not a sync — and it must never reach the delete below (a
      // delete-only commit would wipe the live plan and still stamp 'synced'). Throw so
      // the failure path runs.
      if (postRows.length === 0) {
        throw new Error(
          `planning: generated ${planRows.length} plan rows but 0 writable content_cycle_posts ` +
          `(dates outside ${targetMonth}, or all owned by preserved edits?) — refusing to write or stamp synced`,
        );
      }

      const insertedIds = await db.transaction(async (tx) => {
        // FK-safe: deleteIds are drop+replace only — never a post_edits-referenced row.
        if (deleteIds.length > 0) await tx.delete(contentCyclePosts).where(inArray(contentCyclePosts.id, deleteIds));
        for (const pr of dec.preserve) {
          await tx.update(contentCyclePosts).set({ reviewState: pr.reviewState }).where(eq(contentCyclePosts.id, pr.post.id));
        }
        const ins = await tx.insert(contentCyclePosts).values(postRows).returning({ id: contentCyclePosts.id });
        return ins.map((r) => r.id);
      });

      // Gap (a): VERIFY the write landed before claiming 'synced' — never stamp on
      // an unverified/partial commit. Assert every inserted row is live post-commit
      // and no replace-set row survived. A mismatch is treated as a write failure.
      const liveInserted = await db
        .select({ id: contentCyclePosts.id })
        .from(contentCyclePosts)
        .where(and(inArray(contentCyclePosts.id, insertedIds), isNull(contentCyclePosts.deletedAt)));
      if (liveInserted.length !== postRows.length) {
        throw new Error(`planning: post-write verification failed — expected ${postRows.length} live inserted posts, found ${liveInserted.length}`);
      }
      if (deleteIds.length > 0) {
        const survivors = await db
          .select({ id: contentCyclePosts.id })
          .from(contentCyclePosts)
          .where(and(inArray(contentCyclePosts.id, deleteIds), isNull(contentCyclePosts.deletedAt)));
        if (survivors.length > 0) {
          throw new Error(`planning: post-write verification failed — ${survivors.length} replace-set rows still live after delete`);
        }
      }

      // Only now is it a VERIFIED sync — stamp attributably (posts_synced_at + run id).
      await stampPostsSyncStatus(cycleId, 'synced', { runId: writeRunId, syncedAt: new Date() });
      postsVerifiedSynced = true;
      logger.info(
        { ...logCtx, preserved: dec.preserve.length, orphaned: dec.preserve.filter((d) => d.orphaned).length,
          dropped: dec.drop.length, replaced: dec.replace.length, inserted: postRows.length },
        'content-cycles: edit-aware merge wrote content_cycle_posts (verified synced)',
      );
    } catch (err) {
      // FAIL-LOUD: mark the cycle out_of_sync so the stale app surface is visible in
      // admin. Gap (b): the stamp is NOT fire-and-forget — it runs on a fresh
      // connection with a retry (the shared pool's session may be poisoned by the
      // failure above). If it STILL cannot persist, we do NOT swallow: rethrow so the
      // outer catch fails the cycle loudly rather than leaving a stale 'synced'.
      logger.error({ ...logCtx, err: String(err) }, 'content-cycles: content_cycle_posts merge-write FAILED — marking cycle out_of_sync (workbook unaffected)');
      try {
        await stampPostsSyncStatus(cycleId, 'out_of_sync', { runId: writeRunId });
        postsWriteFailStamped = true;
      } catch (stampErr) {
        logger.error({ ...logCtx, err: String(stampErr) }, 'content-cycles: CRITICAL — could not persist out_of_sync on a fresh connection; escalating rather than leaving a stale synced');
        throw new Error(`content-cycles: could not mark cycle ${cycleId} out_of_sync after a failed posts-write — refusing to continue with a possibly-stale synced: ${String(stampErr)}`);
      }
    }

    if (deliverySurface === 'app') {
      // ── App surface: Drive-free delivery ──────────────────────────────────────
      // No CSV, no xlsx, no Drive. The plan is already in content_cycle_posts, which
      // the app renders on a valid magic-link token (status-independent). The CSV→
      // poller→workbook chain never fires for app clients, so we advance state here
      // through the SAME allowed edges the chain would have driven (intake_confirmed
      // → planning → workbook_built), just without a draft_csv_ref/workbook.
      await transitionCycle(db, cycleId, 'planning', {}, logger);
      await transitionCycle(db, cycleId, 'workbook_built', {}, logger);

      // Ensure a per-cycle app link (idempotent: reuse a live token, mint if absent).
      const appBaseUrl = deps.appBaseUrl ?? process.env['APP_BASE_URL'] ?? '';
      const appUrl = await ensureAppLink(db, clientId, cycleId, appBaseUrl, logger);

      // Link-only "plan ready" notification, PINNED to the test inbox (no attachment,
      // no Drive URL), via the same destination sheet/both use. Best-effort.
      if (appUrl) {
        await sendAppReadyNotification(deps, clientId, clientName, monthLabelOf(targetMonth), appUrl);
      } else {
        logger.warn({ ...logCtx }, 'content-cycles: no app link available — skipping app-ready notification');
      }

      logger.info({ ...logCtx, appLink: appUrl !== null }, 'content-cycles: app-surface planning complete (Drive-free) — cycle at workbook_built');
    } else {
      // ── Sheet / both surface: unchanged CSV → poller → workbook → pinned send ──
      // Filename targets the PLAN month (cycleMonth + 1), so build-workbook names
      // the xlsx for that month and the whole downstream chain stays consistent.
      if (!drive || !driveFolderId) {
        // Defensive: assembleShapeContext guarantees Drive for non-app surfaces.
        throw new Error(`planning: Drive required for surface='${deliverySurface}' but unavailable`);
      }
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

      // ── intake_confirmed → planning ─────────────────────────────────────────
      // Must precede the workbook landing: the DrivePoller xlsx branch advances
      // planning → workbook_built and only matches a cycle already in 'planning'.
      await transitionCycle(db, cycleId, 'planning', { draftCsvRef: csvFileId }, logger);

      logger.info({ ...logCtx, csvFileId }, 'content-cycles: planning complete — handed off to build-workbook pipeline');
    }
  } catch (err) {
    logger.error({ ...logCtx, err: String(err) }, 'content-cycles: planning phase failed');
    // Gap (c): if the run failed WITHOUT resolving the posts stage (no verified sync
    // and no explicit out_of_sync stamp — e.g. a throw upstream of the posts stage),
    // the surface is not verified — downgrade a possibly-stale 'synced' to 'unknown'.
    // Skip if a verified sync already landed (don't corrupt a legitimate 'synced') or
    // if out_of_sync was already stamped (keep that more precise status).
    if (!postsVerifiedSynced && !postsWriteFailStamped) {
      await stampPostsSyncStatus(cycleId, 'unknown', { runId: writeRunId })
        .catch((se) => logger.error({ ...logCtx, err: String(se) }, 'content-cycles: also failed to mark posts_sync_status=unknown on planning failure'));
    }
    await transitionCycle(db, cycleId, 'failed', { failedStep: 'planning' }, logger)
      .catch((te) => {
        logger.error({ ...logCtx, err: String(te) }, 'content-cycles: failed to transition to failed state');
      });
    throw err;
  }
}
