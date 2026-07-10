/**
 * onboard.ts — testable core for the onboarding derivation path (the "onboard" half
 * of the two-command flow). Stages A-F create a new app-surface client from a name +
 * Instagram handle, trawl their posts into ig_posts, derive voice / pillars / cadence,
 * and default categories / register_map — then STOP for operator review. Generation is
 * the separate trigger-plan CLI.
 *
 * Each stage is an individually-runnable function with injected db + model, so a failed
 * stage can be re-run without redoing the others. NEVER touches client_product_catalogue
 * (an empty {} row is a known landmine) and NEVER writes to Drive.
 */

import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db as _db, clients, clientChannels, clientConfigs, voiceSnapshots, clientPlanningConfig, clientProductCatalogue, igPosts } from '@sprigly/db';
import type { ModelClient } from '@sprigly/model-client';
import type { Pillar, Cadence, Catalogue, ParsedProduct, ProductFamily } from '@sprigly/engine';
import type { Logger } from 'pino';
import { fetchApifyPostsForHandle } from '../apify-ig-fetch.js';
import { igPostSchema, mapApifyMediaType } from '../lean-line.js';

type Db = typeof _db;

// Posts below this many usable captions make voice/pillars/cadence weak — Stage B
// warns and requires --force-thin to continue. 15 chosen as a floor where derivation
// still has enough signal to be indicative (IVY-t's live account sits ~38 across 3 months).
export const THIN_CAPTION_FLOOR = 15;

// Apify latest-posts window (mirrors the trawl's APIFY_RESULTS_LIMIT).
const APIFY_RESULTS_LIMIT = 50;

// Generic starter categories for a new brand (NOT IVY-t-specific). The planning code
// gate skips category validation when the list is present but a post uses an unknown
// value only warns — the operator refines these in review.
export const DEFAULT_CATEGORIES: string[] = [
  'Product', 'Launch', 'Education', 'Styling', 'Behind the Scenes', 'Customer Story', 'Founder Note',
];

// register_map default: empty {}. Per the onboarding audit, an empty register_map makes
// the critic lenient (resolveRegister returns null → register inferred from historic posts
// / voice.md) rather than imposing an unverified I/we map on a brand we've only just met.
export const DEFAULT_REGISTER_MAP: Record<string, unknown> = {};

const igPostsArraySchema = z.array(igPostSchema);

// ── Deterministic helpers (no db, no model) ──────────────────────────────────

/** Derive a URL/slug-safe slug from a brand name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

const LONDON_MONTH_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' });

/** London wall-clock 'YYYY-MM' for an ISO timestamp, or null if unparseable. */
export function londonMonth(timestamp: string | undefined): string | null {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return null;
  const parts = LONDON_MONTH_FMT.formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  return y && m ? `${y}-${m}` : null;
}

export interface CadenceResult {
  postCount:            number;
  windowDays:          number;
  observedPostsPerWeek: number;   // rounded to 1dp
  cadence:             Cadence;
}

/** Compute observed posting frequency from post timestamps and a suggested Cadence.
 *  Deterministic — NO model call. windowDays = span between earliest and latest post. */
export function computeCadence(timestamps: string[]): CadenceResult {
  const ms = timestamps.map((t) => new Date(t).getTime()).filter((n) => !isNaN(n)).sort((a, b) => a - b);
  const postCount = ms.length;
  if (postCount === 0) {
    return { postCount: 0, windowDays: 0, observedPostsPerWeek: 0, cadence: { postsPerMonthMin: 0, postsPerMonthMax: 0, maxPerWeek: 0, minPerWeek: 0 } };
  }
  const spanMs = ms[ms.length - 1]! - ms[0]!;
  const windowDays = spanMs / (1000 * 60 * 60 * 24);
  // Rate per week: with a single post or zero span, fall back to postCount over a 1-week floor.
  const weeks = Math.max(windowDays / 7, 1 / 7);   // never divide by zero; a same-day burst → high rate, clamped below
  const rawPerWeek = postCount / Math.max(weeks, 1);   // clamp weeks≥1 so a 1-week burst doesn't explode the rate
  const perWeek = Math.round(rawPerWeek * 10) / 10;
  const perMonth = perWeek * 4.345;
  const cadence: Cadence = {
    postsPerMonthMin: Math.max(1, Math.floor(perMonth * 0.8)),
    postsPerMonthMax: Math.max(1, Math.ceil(perMonth)),
    maxPerWeek:       Math.max(1, Math.ceil(perWeek)),
    minPerWeek:       Math.max(1, Math.floor(perWeek)),
  };
  return { postCount, windowDays: Math.round(windowDays), observedPostsPerWeek: perWeek, cadence };
}

export interface FormatMix {
  counted: number;   // posts that carried a media type (the denominator)
  image: number; reel: number; carousel: number;
  imagePct: number; reelPct: number; carouselPct: number;
}

/** Observed FORMAT MIX (% image/reel/carousel) over the posts that HAVE a media type.
 *  Deterministic — no model call. Posts without a mediaType are excluded from the
 *  denominator (counted), so a run with no media types returns all zeros. */
export function computeFormatMix(mediaTypes: Array<string | undefined>): FormatMix {
  let image = 0, reel = 0, carousel = 0;
  for (const t of mediaTypes) {
    if (t === 'image') image++;
    else if (t === 'reel') reel++;
    else if (t === 'carousel') carousel++;
  }
  const counted = image + reel + carousel;
  const pct = (n: number) => (counted ? Math.round((n / counted) * 100) : 0);
  return { counted, image, reel, carousel, imagePct: pct(image), reelPct: pct(reel), carouselPct: pct(carousel) };
}

// ── Stage A — create client + channel ────────────────────────────────────────

export interface StageAResult { ok: boolean; message: string; clientId?: string; slug?: string; channel: string }

/** Insert clients + client_channels for an app-surface client (no Drive). Refuses if
 *  the slug OR the handle already exists — never mutates an existing client. */
export async function stageCreate(params: {
  db: Db; name: string; handle: string; channel: string; website?: string | undefined;
}): Promise<StageAResult> {
  const { db, name, handle, channel } = params;
  const slug = slugify(name);
  if (!slug) return { ok: false, channel, message: `Could not derive a slug from name "${name}".` };
  const cleanHandle = handle.replace(/^@/, '').trim();
  if (!cleanHandle) return { ok: false, channel, message: 'Instagram handle is empty.' };

  const [slugTaken] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
  if (slugTaken) return { ok: false, channel, message: `A client with slug "${slug}" already exists (id ${slugTaken.id}). Refusing to mutate it.` };

  const [handleTaken] = await db
    .select({ id: clientChannels.id, clientId: clientChannels.clientId })
    .from(clientChannels)
    .where(and(eq(clientChannels.channel, channel), eq(clientChannels.instagramHandle, cleanHandle)))
    .limit(1);
  if (handleTaken) return { ok: false, channel, message: `Handle "@${cleanHandle}" is already onboarded on ${channel} (client ${handleTaken.clientId}). Refusing to duplicate.` };

  const [client] = await db
    .insert(clients)
    .values({ name, slug, ...(params.website ? { verifiedDomain: params.website } : {}) })
    .returning({ id: clients.id });
  if (!client) return { ok: false, channel, message: 'clients insert returned no row.' };

  await db.insert(clientChannels).values({
    clientId:        client.id,
    channel,
    instagramHandle: cleanHandle,
    deliverySurface: 'app',   // Drive-free surface — no drive_folder_id, no OAuth
  });

  // client_configs holds the app's per-tenant feature flags (settings jsonb). The client
  // plan surface renders behind settings.plan_redesign — without a row it defaults OFF and
  // the client sees the legacy surface. Mirror the live rows (IVY-t): only that one key.
  // Idempotent: never overwrite an existing settings blob (no unique constraint on the FK).
  const [existingConfig] = await db.select({ id: clientConfigs.id }).from(clientConfigs).where(eq(clientConfigs.clientId, client.id)).limit(1);
  if (!existingConfig) {
    await db.insert(clientConfigs).values({ clientId: client.id, settings: { plan_redesign: true } });
  }

  return { ok: true, channel, clientId: client.id, slug, message: `Created client "${name}" (slug ${slug}, id ${client.id}) + ${channel} channel @${cleanHandle} (delivery_surface=app, plan_redesign flag on).` };
}

// ── Stage B — trawl into ig_posts ────────────────────────────────────────────

export interface StageBResult {
  ok: boolean; message: string;
  captions: string[]; timestamps: string[]; mediaTypes: string[]; postCount: number; monthsWritten: string[];
  thin: boolean;
}

/** Fetch the account's latest owned posts once, upsert grouped by London month into
 *  ig_posts, and return the caption/timestamp window for derivation. Handles the thin
 *  account case: fewer than THIN_CAPTION_FLOOR captions → thin=true (caller gates). */
export async function stageTrawl(params: {
  db: Db; apifyApiKey: string | undefined; clientId: string; channel: string; handle: string; logger?: Logger;
}): Promise<StageBResult> {
  const { db, apifyApiKey, clientId, channel, handle, logger } = params;
  if (!apifyApiKey) return { ok: false, thin: true, captions: [], timestamps: [], mediaTypes: [], postCount: 0, monthsWritten: [], message: 'APIFY_API_KEY not set — cannot trawl.' };

  const logCtx = { clientId, channel, handle };
  const fetched = await fetchApifyPostsForHandle(handle, APIFY_RESULTS_LIMIT, apifyApiKey, logger ?? ({ info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger), logCtx);
  const owned = fetched.posts;   // owned + hidden-filtered (likes/comments are valid numbers)

  // Map to igPostSchema shape, drop timestamp-less, group by London month.
  const byMonth = new Map<string, Array<Record<string, unknown>>>();
  const captions: string[] = [];
  const timestamps: string[] = [];
  const mediaTypes: string[] = [];
  for (const p of owned) {
    if (!p.timestamp) continue;
    const month = londonMonth(p.timestamp);
    if (!month) continue;
    const mt = mapApifyMediaType(p.type);
    const mapped = { timestamp: p.timestamp, caption: p.caption, likesCount: p.likesCount as number, commentsCount: p.commentsCount as number, ...(mt ? { mediaType: mt } : {}) };
    const parsed = igPostSchema.safeParse(mapped);
    if (!parsed.success) continue;
    (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(parsed.data as unknown as Record<string, unknown>);
    timestamps.push(p.timestamp);
    if (mt) mediaTypes.push(mt);
    if (typeof p.caption === 'string' && p.caption.trim()) captions.push(p.caption.trim());
  }

  const monthsWritten: string[] = [];
  for (const [month, posts] of byMonth) {
    igPostsArraySchema.parse(posts);   // fail loud if any slipped through
    const payload = posts as unknown as Array<Record<string, unknown>>;
    await db.insert(igPosts)
      .values({ clientId, channel, month, posts: payload })
      .onConflictDoUpdate({ target: [igPosts.clientId, igPosts.channel, igPosts.month], set: { posts: payload, updatedAt: new Date() } });
    monthsWritten.push(month);
  }
  monthsWritten.sort();

  const thin = captions.length < THIN_CAPTION_FLOOR;
  return {
    ok: true, thin, captions, timestamps, mediaTypes, postCount: timestamps.length, monthsWritten,
    message: `Trawled ${timestamps.length} owned posts (${captions.length} captions, ${mediaTypes.length} with media type) across ${monthsWritten.length} month(s): ${monthsWritten.join(', ')}.`,
  };
}

/** Read the caption/timestamp window back from ig_posts (all months) for a client —
 *  used to re-derive without re-trawling, and for calibration (read-only). */
export async function loadIgPostsWindow(db: Db, clientId: string, channel: string): Promise<{ captions: string[]; timestamps: string[]; mediaTypes: string[]; postCount: number; months: string[] }> {
  const rows = await db.select({ month: igPosts.month, posts: igPosts.posts }).from(igPosts)
    .where(and(eq(igPosts.clientId, clientId), eq(igPosts.channel, channel)));
  const captions: string[] = [];
  const timestamps: string[] = [];
  const mediaTypes: string[] = [];
  const months: string[] = [];
  for (const r of rows) {
    months.push(r.month);
    for (const p of (Array.isArray(r.posts) ? r.posts : [])) {
      const ts = p['timestamp']; const cap = p['caption']; const mt = p['mediaType'];
      if (typeof ts === 'string') timestamps.push(ts);
      if (typeof cap === 'string' && cap.trim()) captions.push(cap.trim());
      if (typeof mt === 'string') mediaTypes.push(mt);
    }
  }
  months.sort();
  return { captions, timestamps, mediaTypes, postCount: timestamps.length, months };
}

// ── Stage C — derive voice (model) ───────────────────────────────────────────

const VOICE_SYSTEM = `You are a brand-voice analyst for a social-media agency. You are given a clothing brand's REAL Instagram captions and must produce a FULL, reusable voice-profile document that another writer could follow to draft on-brand captions.

Derive EVERYTHING from the captions provided. Do NOT invent facts about the brand's products, founder, or history that the captions do not evidence. Where the captions are thin or silent on something, say so briefly rather than fabricating.

Output GitHub-flavoured markdown ONLY (no preamble, no code fences), structured EXACTLY with these sections:

## {CHANNEL} — Voice Profile

### Tone & personality
(3-6 bullets: the register and character of the voice, with short evidence.)

### Sentence & structure
(sentence length, rhythm, paragraphing, how posts open and close.)

### Point of view / register
(first-person founder "I" vs brand "we/our" — which post types use which, if discernible.)

### Vocabulary
**Use:** (words/phrases the brand favours)
**Avoid:** (words/registers absent or off-brand)

### Formatting conventions
(emoji usage, hashtags, capitalisation, exclamation marks, dashes, sign-offs — with what the captions actually do.)

### Signature moves
(recurring devices: CTAs, personification, specific framings, storytelling patterns.)

### Do / Don't
(a short, actionable do/don't list for a writer replicating this voice.)

Keep it concrete and evidence-led. This is a working document, not a summary.`;

export interface DeriveVoiceResult { voiceDoc: string; usage: { inputTokens: number; outputTokens: number; modelId: string } }

/** Model call: derive a full voice-profile document from captions. */
export async function deriveVoiceProfile(params: {
  model: ModelClient; captions: string[]; brandName: string; channel: string;
}): Promise<DeriveVoiceResult> {
  const { model, captions, brandName, channel } = params;
  const channelTitle = channel.charAt(0).toUpperCase() + channel.slice(1);
  const user = [
    `BRAND: ${brandName}`,
    `CHANNEL: ${channelTitle}`,
    '',
    `CAPTIONS (${captions.length}, most recent first):`,
    ...captions.map((c, i) => `--- caption ${i + 1} ---\n${c}`),
    '',
    `Produce the voice-profile document for ${brandName} now, using "## ${channelTitle} — Voice Profile" as the first heading.`,
  ].join('\n');

  const result = await model.complete({ model: 'sonnet', system: VOICE_SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: 4_000 });
  return { voiceDoc: result.content.trim(), usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, modelId: result.modelId } };
}

// ── Stage D — derive pillars (model) ─────────────────────────────────────────

const PILLARS_SYSTEM = `You classify a clothing brand's real Instagram captions into content pillars (recurring themes the brand posts about). Derive ONLY from the captions.

Return between 4 and 7 pillars. For each: a short Name (title case, 1-4 words), a one-line description, and the approximate share of posts it represents (an integer percentage; the shares should roughly sum to 100).

Return ONE JSON object and nothing else, no markdown, no code fences:
{"pillars":[{"name":"","description":"","sharePct":0}]}`;

export interface DerivedPillar { name: string; description: string; sharePct: number }
export interface DerivePillarsResult { pillars: DerivedPillar[]; usage: { inputTokens: number; outputTokens: number; modelId: string } }

/** Tolerant parse of the pillar JSON (slice to outer object; light repair). */
export function parsePillarsResponse(text: string): DerivedPillar[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  if (!raw.startsWith('{')) { const s = raw.indexOf('{'); const e = raw.lastIndexOf('}'); if (s !== -1 && e > s) raw = raw.slice(s, e + 1); }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1')); }
  const arr = (parsed as { pillars?: unknown })?.pillars;
  if (!Array.isArray(arr)) throw new Error('pillars response missing "pillars" array');
  return arr.map((p) => {
    const o = p as Record<string, unknown>;
    const name = typeof o['name'] === 'string' ? o['name'].trim() : '';
    if (!name) throw new Error('pillar missing name');
    return { name, description: typeof o['description'] === 'string' ? o['description'].trim() : '', sharePct: Number(o['sharePct']) || 0 };
  });
}

export async function derivePillars(params: { model: ModelClient; captions: string[]; brandName: string }): Promise<DerivePillarsResult> {
  const { model, captions, brandName } = params;
  const user = [
    `BRAND: ${brandName}`,
    '',
    `CAPTIONS (${captions.length}):`,
    ...captions.map((c, i) => `--- caption ${i + 1} ---\n${c}`),
    '',
    'Classify into 4-7 content pillars now. JSON only.',
  ].join('\n');
  const result = await model.complete({ model: 'sonnet', system: PILLARS_SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: 1_500 });
  return { pillars: parsePillarsResponse(result.content), usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, modelId: result.modelId } };
}

/** Map derived pillars to the client_planning_config Pillar shape (share is kept only
 *  in the review file — the Pillar type/planning prompt use name + tagline + messages). */
export function toConfigPillars(derived: DerivedPillar[]): Pillar[] {
  return derived.map((p) => ({ name: p.name, tagline: p.description, keyMessages: [], contentIdeas: [] }));
}

// ── Writers (Stage C/D/E/F persistence) ──────────────────────────────────────

/** Write the derived voice document as the client's current voice snapshot (mirrors
 *  seed-voice.ts: isCurrent=true). Flips any existing current snapshot off first. */
export async function writeVoiceSnapshot(db: Db, clientId: string, channel: string, voiceDoc: string): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.update(voiceSnapshots).set({ isCurrent: false, updatedAt: new Date() })
      .where(and(eq(voiceSnapshots.clientId, clientId), eq(voiceSnapshots.channel, channel), eq(voiceSnapshots.isCurrent, true)));
    const [row] = await tx.insert(voiceSnapshots)
      .values({ clientId, channel, snapshotMd: voiceDoc, reason: 'onboarding-derived', isCurrent: true })
      .returning({ id: voiceSnapshots.id });
    return row!.id;
  });
}

export interface PlanningConfigWrite { pillars: Pillar[]; cadence: Cadence; categories: string[]; registerMap: Record<string, unknown> }

/** Upsert client_planning_config (pillars/cadence/categories/register_map). One row per
 *  (client, channel). NEVER touches client_product_catalogue. */
export async function writePlanningConfig(db: Db, clientId: string, channel: string, cfg: PlanningConfigWrite): Promise<void> {
  await db.insert(clientPlanningConfig)
    .values({
      clientId, channel,
      pillars:     cfg.pillars as unknown as Array<Record<string, unknown>>,
      cadence:     cfg.cadence as unknown as Record<string, number>,
      categories:  cfg.categories,
      registerMap: cfg.registerMap,
    })
    .onConflictDoUpdate({
      target: [clientPlanningConfig.clientId, clientPlanningConfig.channel],
      set: {
        pillars:     cfg.pillars as unknown as Array<Record<string, unknown>>,
        cadence:     cfg.cadence as unknown as Record<string, number>,
        categories:  cfg.categories,
        registerMap: cfg.registerMap,
        updatedAt:   new Date(),
      },
    });
}

// ── Stage G — optional Shopify catalogue from the client's website ────────────
//
// SECURITY: the site is treated PURELY as product DATA. We fetch ONLY the Shopify
// products endpoints and read structured JSON fields; we never fetch or act on any
// other site file (robots.txt, agents.md, etc.) and never interpret free text as
// instructions. This catalogue carries NO sales signal (all sales are 0) and is
// marked source:'shopify-web' so downstream can tell it from a sales-CSV catalogue.

interface ShopifyVariant { title?: string; option1?: string | null; option2?: string | null; option3?: string | null }
interface ShopifyProduct { title?: string; handle?: string; body_html?: string; product_type?: string; tags?: string[] | string; variants?: ShopifyVariant[] }

/** Strip HTML tags/entities from a body_html blurb → collapsed plain text. */
function stripHtml(html: string): string {
  return (html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch a Shopify storefront's products from the public JSON endpoints. Tries
 *  /products.json then /collections/all/products.json; paginates to a ~250 cap.
 *  Any 404 / disabled endpoint / parse failure → returns [] (caller writes nothing). */
async function fetchShopifyProducts(website: string): Promise<ShopifyProduct[]> {
  const base = website.replace(/\/+$/, '');
  for (const ep of ['/products.json', '/collections/all/products.json']) {
    const all: ShopifyProduct[] = [];
    let ok = false;
    for (let page = 1; page <= 5 && all.length < 250; page++) {
      let res: Response;
      try {
        res = await fetch(`${base}${ep}?limit=250&page=${page}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      } catch { break; }
      if (!res.ok) break;                       // 404/403/etc → try the next endpoint
      ok = true;
      let json: { products?: unknown };
      try { json = await res.json() as { products?: unknown }; } catch { break; }
      const products = Array.isArray(json.products) ? (json.products as ShopifyProduct[]) : [];
      if (products.length === 0) break;
      all.push(...products);
      if (products.length < 250) break;          // last page
    }
    if (ok && all.length > 0) return all.slice(0, 250);
  }
  return [];
}

/** Web-derived catalogue carrying provenance. Extends Catalogue with source/fetchedAt
 *  (extra keys the readers ignore) so a sales-CSV catalogue is distinguishable. */
type WebCatalogue = Catalogue & { source: 'shopify-web'; fetchedAt: string };

/** GROUPING RULE: one ProductFamily per Shopify PRODUCT (family name = product title),
 *  with product_type (or the first tag, else "Product") as the family `style`; each
 *  Shopify variant becomes one ParsedProduct whose colourway is its first variant option
 *  value (colour / size / scent — whatever the product's variant axis is), with the
 *  synthetic "Default Title" treated as no variant. All sales are 0 (no web sales signal). */
export function mapShopifyToCatalogue(products: ShopifyProduct[]): WebCatalogue {
  const families: ProductFamily[] = [];
  let variantTotal = 0;
  for (const p of products) {
    const name = (p.title ?? '').trim();
    if (!name) continue;
    const firstTag = Array.isArray(p.tags) ? (p.tags[0] ?? '') : (typeof p.tags === 'string' ? (p.tags.split(',')[0] ?? '').trim() : '');
    const style = (p.product_type ?? '').trim() || firstTag || 'Product';
    const variants: ParsedProduct[] = [];
    for (const v of (p.variants ?? [])) {
      const opt = (v.option1 ?? '').trim();
      const colourway = opt && opt.toLowerCase() !== 'default title' ? opt : undefined;
      variants.push({
        originalTitle: colourway ? `${name} ${colourway}` : name,
        conforming: true, name, style, status: 'live', kids: false,
        ...(colourway ? { colourway } : {}),
        sales: { netItemsSold: 0, netSales: 0, returns: 0 },
      });
    }
    if (variants.length === 0) {
      variants.push({ originalTitle: name, conforming: true, name, style, status: 'live', kids: false, sales: { netItemsSold: 0, netSales: 0, returns: 0 } });
    }
    variantTotal += variants.length;
    const description = stripHtml(p.body_html ?? '').slice(0, 240);
    families.push({ family: `${name} ${style}`, name, style, kids: false, variants, ...(description ? { description } : {}) } as ProductFamily);
  }
  return {
    families, flagged: [],
    statusBreakdown: { live: variantTotal, 'pre-order': 0, 'back-soon': 0, 'sample-sale': 0 },
    source: 'shopify-web', fetchedAt: new Date().toISOString(),
  };
}

export interface StageGResult { ok: boolean; skipped: boolean; message: string; familyCount: number; productCount: number; variantCount: number; sampleNames: string[] }

/**
 * Fetch the client's Shopify catalogue and write it to client_product_catalogue.
 * Skips cleanly (writes NOTHING) when no Shopify catalogue is exposed. Idempotent:
 * replaces an existing shopify-web catalogue, but REFUSES to overwrite a sales-CSV
 * catalogue. NEVER writes an empty ({}) row (a known landmine).
 */
export async function stageShopifyCatalogue(params: {
  db: Db; clientId: string; channel: string; website: string; logger?: Logger;
}): Promise<StageGResult> {
  const { db, clientId, channel, website } = params;
  const empty = { familyCount: 0, productCount: 0, variantCount: 0, sampleNames: [] as string[] };

  const products = await fetchShopifyProducts(website);
  if (products.length === 0) {
    return { ok: true, skipped: true, message: `no Shopify catalogue exposed at ${website} — skipping (no row written).`, ...empty };
  }

  // Idempotency guard: never clobber a sales-CSV catalogue with web data.
  const [existing] = await db.select({ catalogue: clientProductCatalogue.catalogue }).from(clientProductCatalogue)
    .where(and(eq(clientProductCatalogue.clientId, clientId), eq(clientProductCatalogue.channel, channel))).limit(1);
  if (existing) {
    const src = (existing.catalogue as { source?: unknown } | null)?.source;
    if (src !== 'shopify-web') {
      return { ok: false, skipped: true, message: 'a sales-CSV catalogue already exists for this client/channel — refusing to overwrite it with web-derived data.', ...empty };
    }
  }

  const cat = mapShopifyToCatalogue(products);
  if (cat.families.length === 0) {
    return { ok: true, skipped: true, message: 'Shopify returned products but none mapped to a family — skipping (no row written).', ...empty };
  }

  const payload = cat as unknown as Record<string, unknown>;
  await db.insert(clientProductCatalogue)
    .values({ clientId, channel, sourceMonth: null, catalogue: payload, refreshedAt: new Date() })
    .onConflictDoUpdate({
      target: [clientProductCatalogue.clientId, clientProductCatalogue.channel],
      set: { catalogue: payload, sourceMonth: null, refreshedAt: new Date(), updatedAt: new Date() },
    });

  const variantCount = cat.families.reduce((n, f) => n + f.variants.length, 0);
  return {
    ok: true, skipped: false,
    message: `Shopify catalogue written: ${cat.families.length} products / ${variantCount} variants (source=shopify-web, no sales signal).`,
    familyCount: cat.families.length, productCount: products.length, variantCount,
    sampleNames: cat.families.slice(0, 8).map((f) => f.name),
  };
}
