/**
 * lean-line.ts — builds a 1–2 sentence content recommendation for the monthly
 * request email from two ranked data sources in the client's Drive folder.
 *
 * Sources (both optional — graceful degradation when either is absent):
 *   1. Sales: "sales-YYYY-MM.csv" dropped into the client's monitored Drive folder.
 *      Shopify "Sales by product" format; column names matched by header, not position.
 *   2. Engagement: Instagram posts for the month, read from the ig_posts DB table
 *      (re-homed off Drive). Written by the Apify trawl (ig-producer.ts) and the
 *      admin IG upload. Shape: IgPost[] (igPostSchema below).
 *
 * Call site: the Phase 3 monthly-request-email job.
 * CONTRACT: caller MUST omit the lean section when buildLeanLine() returns null.
 * Never render an empty lean intro — check for null before building the email body.
 */

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db as _db, igPosts } from '@sprigly/db';
import type { DriveApiClient } from '@sprigly/sources';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { Logger } from 'pino';

type Db = typeof _db;

// ── Public types ──────────────────────────────────────────────────────────────

export interface PromptResolver {
  resolve(clientId: string, workflowId: string, stepName: string): Promise<string>;
}

export interface TopSeller {
  product: string;
  units: number;
}

export interface TopPost {
  snippet: string;    // ≤15 words from caption, truncated with ellipsis
  engagement: number; // likesCount + commentsCount
}

export interface BuildLeanLineParams {
  clientId:      string;
  clientName:    string;
  channel:       string;
  month:         string;       // YYYY-MM (last calendar month)
  driveFolderId: string;       // sales CSV still lives in Drive (fetchTopSellers)
  drive:         DriveApiClient;
  db:            Db;           // IG engagement now read from ig_posts (fetchTopPosts)
  model:         ModelClient;
  audit:         AuditLogger;
  logger:        Logger;
  prompts:       PromptResolver;
}

// ── Prompt ────────────────────────────────────────────────────────────────────
// Resolved at runtime from the prompt store (workflow=content-cycle-request-email, step=lean-line).
// Seeded by migration 0038_lean_line_prompt.sql. No in-source fallback — throw-on-missing like
// the blog pipeline steps, so a missing row surfaces immediately rather than silently degrading.
export const LEAN_LINE_WORKFLOW = 'content-cycle-request-email';
export const LEAN_LINE_STEP     = 'lean-line';

// ── CSV column matching ───────────────────────────────────────────────────────

const PRODUCT_COLS  = ['product title', 'product name', 'product', 'title', 'item'];
const QUANTITY_COLS = [
  'net items sold', 'items sold', 'net quantity', 'units sold',
  'quantity sold', 'qty sold', 'quantity',
];
const DATE_COLS     = ['day', 'date', 'order date'];

// ── CSV parsing ───────────────────────────────────────────────────────────────

/** Minimal RFC 4180 CSV parser. Handles quoted fields and embedded commas. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  // Strip BOM that Shopify sometimes prepends to UTF-8 exports.
  const input = text.replace(/^﻿/, '');
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const fields: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        i++;
        let field = '';
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
          else if (line[i] === '"') { i++; break; }
          else { field += line[i++]; }
        }
        fields.push(field);
        if (line[i] === ',') i++;
      } else {
        const end = line.indexOf(',', i);
        if (end === -1) { fields.push(line.slice(i)); break; }
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
    rows.push(fields);
  }
  return rows;
}

function findColIndex(headers: string[], candidates: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = norm.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse a Shopify "Sales by product" CSV buffer.
 * Returns top 5 sellers for `month` (YYYY-MM), or [] if columns unrecognised.
 * Exported for unit tests.
 */
export function parseSalesCsv(csvBuf: Buffer, month: string): TopSeller[] {
  const rows = parseCsvRows(csvBuf.toString('utf-8'));
  if (rows.length < 2) return [];

  const headers     = rows[0]!;
  const productIdx  = findColIndex(headers, PRODUCT_COLS);
  const quantityIdx = findColIndex(headers, QUANTITY_COLS);
  const dateIdx     = findColIndex(headers, DATE_COLS);

  if (productIdx === -1 || quantityIdx === -1) return [];

  const totals = new Map<string, number>();
  for (const row of rows.slice(1)) {
    if (dateIdx !== -1) {
      const dateVal = (row[dateIdx] ?? '').trim();
      if (!dateVal.startsWith(month)) continue;
    }
    const product = (row[productIdx] ?? '').trim();
    const qty     = parseFloat((row[quantityIdx] ?? '').replace(/,/g, ''));
    if (!product || isNaN(qty) || qty <= 0) continue;
    totals.set(product, (totals.get(product) ?? 0) + qty);
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([product, units]) => ({ product, units: Math.round(units) }));
}

// ── Instagram JSON schema ─────────────────────────────────────────────────────
// Exported so the external producer (scrape step or manual export) can be written
// against this contract. Validation in fetchTopPosts warns on any mismatch rather
// than silently degrading to empty engagement data.

export const igPostSchema = z.object({
  timestamp:     z.string(),
  caption:       z.string().optional(),
  likesCount:    z.number().int().nonnegative(),
  commentsCount: z.number().int().nonnegative(),
  // Instagram media type, retained so the format mix is known. Optional — rows written
  // before this existed (and any post whose Apify `type` was unrecognised) have no key.
  mediaType:     z.enum(['image', 'reel', 'carousel']).optional(),
});
export type IgPost = z.infer<typeof igPostSchema>;
const igPostsArraySchema = z.array(igPostSchema);

/** Map an Apify instagram-scraper item `type` to our ig_posts mediaType.
 *  Video → reel, Sidecar → carousel, Image → image; anything else → undefined
 *  (the caller omits the key rather than guessing).
 *
 *  Matched case-insensitively on a trimmed value. The actor returns 'Video' | 'Sidecar' |
 *  'Image' today — verified against 278 live items — but the competitor gather's own
 *  normaliser (competitor-gather.ts normalizeType) has always lowercased, and two mappers
 *  reading the same field with different strictness is a silent-divergence waiting to
 *  happen. Casing is not a fact worth failing on.
 *
 *  KNOWN LIMIT: every 'Video' becomes 'reel'. Apify distinguishes them on `productType`
 *  ('clips' = reel, 'feed' = an in-feed video), which we do not read — ig_posts' mediaType
 *  enum has no 'video' member to put one in. All 184 of ivy-t's videos are 'clips', so the
 *  conflation costs nothing on her data; an account that posts feed video would have those
 *  posts counted as reels. */
export function mapApifyMediaType(type: string | undefined): 'image' | 'reel' | 'carousel' | undefined {
  switch ((type ?? '').trim().toLowerCase()) {
    case 'video':   return 'reel';
    case 'sidecar': return 'carousel';
    case 'image':   return 'image';
    default:        return undefined;
  }
}

/** The label a missing/blank `type` is tallied under — distinguishes "Apify sent a value we
 *  do not know" from "Apify sent no value at all", which have different fixes. */
export const ABSENT_MEDIA_TYPE = '(absent)';

/**
 * Tally the raw Apify `type` values that {@link mapApifyMediaType} could not place.
 *
 * The mapper's `undefined` return makes the writer omit the mediaType key, and an omitted
 * key is indistinguishable downstream from a row written before the key existed — which is
 * exactly how ivy-t's 31 untyped posts read as a mapper fault when they were staleness. A
 * caller that maps a batch calls this and logs the result, so the raw value and its count
 * are on the record at the moment of the loss rather than inferred from its shape months
 * later. Empty tally → nothing to say; callers log only when it is non-empty.
 */
export function tallyUnmappedMediaTypes(rawTypes: Array<string | undefined>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const raw of rawTypes) {
    if (mapApifyMediaType(raw)) continue;
    const key = (raw ?? '').trim() || ABSENT_MEDIA_TYPE;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

function captionSnippet(caption: string | undefined): string {
  if (!caption) return '';
  const words = caption.trim().split(/\s+/);
  return words.length <= 15 ? words.join(' ') : words.slice(0, 15).join(' ') + '…';
}

// Reuse a single formatter instance — Intl construction is moderately expensive.
const londonMonthFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year:     'numeric',
  month:    '2-digit',
});

function postInMonth(timestamp: string | undefined, month: string): boolean {
  if (!timestamp) return false;
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return false;
    const parts = londonMonthFormatter.formatToParts(d);
    const year  = parts.find((p) => p.type === 'year')?.value  ?? '';
    const mon   = parts.find((p) => p.type === 'month')?.value ?? '';
    return `${year}-${mon}` === month;
  } catch {
    return false;
  }
}

/**
 * Parse an Apify instagram-scraper JSON buffer.
 * Returns top 5 posts for `month` (YYYY-MM) ranked by likes + comments.
 * Timestamps are evaluated in Europe/London wall-clock time.
 *
 * Throws on invalid JSON or schema mismatch — caller (fetchTopPosts) catches
 * and logs at WARN with the filename and failing reason.
 * Exported for unit tests.
 */
export function parseIgPostsJson(jsonBuf: Buffer, month: string): TopPost[] {
  // Throws SyntaxError on bad JSON — propagated to caller.
  const raw = JSON.parse(jsonBuf.toString('utf-8')) as unknown;
  // Throws ZodError on schema mismatch — propagated to caller.
  const posts = igPostsArraySchema.parse(raw);

  return posts
    .filter((p) => postInMonth(p.timestamp, month))
    .map((p) => ({
      snippet:    captionSnippet(p.caption),
      engagement: p.likesCount + p.commentsCount,
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 5);
}

// ── Drive reads ───────────────────────────────────────────────────────────────

async function fetchTopSellers(
  drive:         DriveApiClient,
  driveFolderId: string,
  month:         string,
  logger:        Logger,
  clientId:      string,
  channel:       string,
): Promise<TopSeller[] | null> {
  const target = `sales-${month}.csv`;
  try {
    const files = await drive.listFiles(driveFolderId);
    const meta  = files.find((f) => f.name.toLowerCase() === target);
    if (!meta) {
      logger.info({ clientId, channel, month, target }, 'lean-line: sales CSV not present in Drive');
      return null;
    }
    const buf     = await drive.downloadFile(meta.id);
    const sellers = parseSalesCsv(buf, month);
    if (sellers.length === 0) {
      logger.info({ clientId, channel, month }, 'lean-line: sales CSV present but no usable rows for month');
      return null;
    }
    return sellers;
  } catch (err) {
    logger.warn({ clientId, channel, month, err: String(err) },
      'lean-line: error reading sales CSV — treating as absent');
    return null;
  }
}

async function fetchTopPosts(
  db:       Db,
  month:    string,
  logger:   Logger,
  clientId: string,
  channel:  string,
): Promise<TopPost[] | null> {
  // Reads the ig_posts DB row for (client, channel, month) — re-homed off Drive.
  const logCtx = { clientId, channel, month };

  // Outer catch: DB errors — treat as absent (same graceful-degradation contract).
  let row: { posts: Array<Record<string, unknown>> } | undefined;
  try {
    [row] = await db
      .select({ posts: igPosts.posts })
      .from(igPosts)
      .where(and(eq(igPosts.clientId, clientId), eq(igPosts.channel, channel), eq(igPosts.month, month)))
      .limit(1);
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err) },
      'lean-line: DB error reading ig_posts — engagement source omitted');
    return null;
  }

  if (!row) {
    logger.info({ ...logCtx }, 'lean-line: no ig_posts row for month, engagement source omitted');
    return null;
  }

  // Inner catch: schema-validation errors — reuse the exact validate+rank path the
  // former Drive JSON file went through, by feeding the stored array back through it.
  let posts: TopPost[];
  try {
    posts = parseIgPostsJson(Buffer.from(JSON.stringify(row.posts)), month);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ ...logCtx, reason },
      'lean-line: ig_posts row present but failed parse/validation — engagement source omitted');
    return null;
  }

  if (posts.length === 0) {
    logger.info({ ...logCtx }, 'lean-line: IG posts valid but no posts matched the month');
    return null;
  }
  return posts;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function formatSellers(sellers: TopSeller[]): string {
  return sellers.map((s, i) => `  ${i + 1}. ${s.product} — ${s.units} units`).join('\n');
}

function formatPosts(posts: TopPost[]): string {
  return posts
    .map((p, i) => `  ${i + 1}. Post featuring "${p.snippet}" — ${p.engagement} engagement`)
    .join('\n');
}

function buildUserMessage(
  clientName: string,
  month:      string,
  sellers:    TopSeller[] | null,
  posts:      TopPost[]   | null,
): string {
  const [yearStr, monStr] = month.split('-');
  const monthLabel = new Date(Number(yearStr), Number(monStr) - 1, 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'Europe/London',
  });

  const parts: (string | false)[] = [
    `Client: ${clientName}\nMonth: ${monthLabel}`,
    !!sellers && `TOP SELLERS LAST MONTH (by units sold):\n${formatSellers(sellers)}`,
    !!posts   && `TOP POSTS LAST MONTH (by likes + comments):\n` +
                 `(Caption snippets are provided only to identify which post/product each figure refers to — do not characterise or quote them.)\n` +
                 `${formatPosts(posts)}`,
    'Write 1–2 sentences recommending what to lean into next month\'s content.',
    (sellers && posts)
      ? 'Bias toward items that appear in BOTH lists — sold well AND engaged well.\n' +
        'If a top seller has no matching post in the engagement list, note it as an under-posted opportunity.'
      : sellers
        ? 'Engagement data unavailable — if you mention it, one short clause only, not a full sentence.'
        : 'Sales data unavailable — if you mention it, one short clause only, not a full sentence.',
  ];

  return parts.filter(Boolean).join('\n\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a 1–2 sentence lean-line string, or null when both sources are absent.
 *
 * Null contract: the caller (Phase 3 monthly-request-email job) MUST omit the
 * lean section entirely when this returns null. Never render a blank intro.
 */
export async function buildLeanLine(params: BuildLeanLineParams): Promise<string | null> {
  const { clientId, clientName, channel, month, driveFolderId, drive, db, model, audit, logger, prompts } = params;
  const logCtx = { clientId, channel, month };

  const [sellers, posts] = await Promise.all([
    fetchTopSellers(drive, driveFolderId, month, logger, clientId, channel),
    fetchTopPosts(db, month, logger, clientId, channel),
  ]);

  if (!sellers && !posts) {
    logger.info({ ...logCtx, sourceSales: false, sourceEngagement: false },
      'lean-line: both sources absent — caller should omit lean section');
    return null;
  }

  const systemPrompt = await prompts.resolve(clientId, LEAN_LINE_WORKFLOW, LEAN_LINE_STEP);
  const userMessage  = buildUserMessage(clientName, month, sellers, posts);

  const result = await model.completeStreaming({
    model:     'haiku',
    system:    systemPrompt,
    messages:  [{ role: 'user', content: userMessage }],
    maxTokens: 150,
  });

  try {
    await audit.logModelCall({
      clientId,
      modelId:      result.modelId,
      inputTokens:  result.inputTokens,
      outputTokens: result.outputTokens,
      action:       'content-cycle:lean-line',
      metadata:     { channel, month, sourceSales: !!sellers, sourceEngagement: !!posts },
    });
  } catch (auditErr) {
    logger.warn({ ...logCtx, err: String(auditErr) }, 'lean-line: audit log failed — non-fatal');
  }

  const leanLine = result.content.trim();
  if (!leanLine) {
    logger.warn({ ...logCtx, sourceSales: !!sellers, sourceEngagement: !!posts },
      'lean-line: model returned empty response — returning null');
    return null;
  }

  logger.info({
    ...logCtx,
    sourceSales:       !!sellers,
    sourceEngagement:  !!posts,
    outputLength:      leanLine.length,
    inputTokens:       result.inputTokens,
    outputTokens:      result.outputTokens,
  }, 'lean-line: generated');

  return leanLine;
}
