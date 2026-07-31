/**
 * deep-trawl.ts — reach further back than the routine 50 and write the months it finds.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 *
 * resultsLimit is a count of the account's MOST RECENT posts, not a date window, so a
 * mid-month trawl spends part of its budget on the current month and reaches
 * proportionally less far back. ivy-t's prod 2026-06 row holds 16 posts against the 29 she
 * published, because the 21 July run at 50 only reached early June. Every derivation
 * downstream — cadence, format mix, pillar weights — is computed over whatever happens to
 * be in ig_posts, and reports its confidence from that same truncated set.
 *
 * A deep trawl is a one-off operator act: pick a depth, reach back years instead of weeks,
 * write the months that come back. It is ADDITIVE — inserts new month rows and deepens
 * existing ones. It is not a migration and it changes no schema.
 *
 * ── What protects the existing rows ──────────────────────────────────────────────────
 *
 * The ig_posts upsert is latest-wins on the WHOLE posts array per (client, channel,
 * month) — onConflictDoUpdate replaces, it does not merge. That is safe when the incoming
 * month is deeper than the stored one and unsafe when it is shallower, and shallower does
 * happen: the OLDEST month a deep trawl reaches is a partial month (the depth ran out
 * mid-month), and a post deleted from Instagram since the last trawl simply will not come
 * back. So every month is compared before it is written and a month that would SHRINK is
 * skipped by default, named in the output, and only written under an explicit
 * --allow-shrink. No row is ever deleted, and no month the trawl did not reach is touched.
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db as _db, igPosts } from '@sprigly/db';
import type { Logger } from 'pino';
import { fetchApifyPostsForHandle } from './apify-ig-fetch.js';
import { igPostSchema, mapApifyMediaType, tallyUnmappedMediaTypes } from './lean-line.js';
import { londonMonth } from './onboarding/onboard.js';

type Db = typeof _db;

const igPostsArraySchema = z.array(igPostSchema);

/** The actor's wall-clock scales with depth; 120s is only enough for the routine 50.
 *  Measured: a 300-post call aborted at exactly 120s, and completed inside 15 minutes. */
export const DEEP_TRAWL_TIMEOUT_MS = 900_000;

// ── The stored/incoming picture, in the terms the operator verifies ──────────────────

export interface MonthBreakdown {
  month:    string;
  posts:    number;
  typed:    number;                        // posts carrying a mediaType
  formats:  Record<string, number>;        // mediaType → count
  oldest:   string;
  newest:   string;
}

export interface TrawlSnapshot {
  months:   MonthBreakdown[];
  posts:    number;
  typed:    number;
  formats:  Record<string, number>;
  oldest:   string;
  newest:   string;
}

/** Fold a set of stored ig_posts elements into the breakdown the runbook asks for. */
export function summarise(byMonth: Map<string, Array<Record<string, unknown>>>): TrawlSnapshot {
  const months: MonthBreakdown[] = [];
  const allFormats: Record<string, number> = {};
  let posts = 0, typed = 0;
  const allTs: string[] = [];

  for (const month of [...byMonth.keys()].sort()) {
    const arr = byMonth.get(month)!;
    const formats: Record<string, number> = {};
    const ts: string[] = [];
    let monthTyped = 0;
    for (const p of arr) {
      const mt = p['mediaType'];
      if (typeof mt === 'string') { monthTyped++; formats[mt] = (formats[mt] ?? 0) + 1; allFormats[mt] = (allFormats[mt] ?? 0) + 1; }
      if (typeof p['timestamp'] === 'string') ts.push(p['timestamp']);
    }
    ts.sort();
    posts += arr.length;
    typed += monthTyped;
    allTs.push(...ts);
    months.push({ month, posts: arr.length, typed: monthTyped, formats, oldest: ts[0] ?? '', newest: ts[ts.length - 1] ?? '' });
  }

  allTs.sort();
  return { months, posts, typed, formats: allFormats, oldest: allTs[0] ?? '', newest: allTs[allTs.length - 1] ?? '' };
}

/** Read what is stored today, grouped by month. Read-only — the "before" of the runbook. */
export async function readStored(db: Db, clientId: string, channel: string): Promise<Map<string, Array<Record<string, unknown>>>> {
  const rows = await db.select({ month: igPosts.month, posts: igPosts.posts }).from(igPosts)
    .where(and(eq(igPosts.clientId, clientId), eq(igPosts.channel, channel)));
  const byMonth = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) byMonth.set(r.month, Array.isArray(r.posts) ? r.posts : []);
  return byMonth;
}

// ── Grouping ─────────────────────────────────────────────────────────────────────────

/** Map raw Apify items to the ig_posts shape and group them by London month. Items with
 *  no usable timestamp, or that fail the shared schema, are dropped and counted. */
export function groupByLondonMonth(
  raw: Array<{ timestamp?: string; caption?: string; likesCount?: number | null; commentsCount?: number | null; type?: string }>,
): { byMonth: Map<string, Array<Record<string, unknown>>>; dropped: number } {
  const byMonth = new Map<string, Array<Record<string, unknown>>>();
  let dropped = 0;
  for (const p of raw) {
    const month = londonMonth(p.timestamp);
    if (!month) { dropped++; continue; }
    const mt = mapApifyMediaType(p.type);
    const parsed = igPostSchema.safeParse({
      timestamp: p.timestamp, caption: p.caption,
      likesCount: p.likesCount as number, commentsCount: p.commentsCount as number,
      ...(mt ? { mediaType: mt } : {}),
    });
    if (!parsed.success) { dropped++; continue; }
    const arr = byMonth.get(month) ?? [];
    arr.push(parsed.data as unknown as Record<string, unknown>);
    byMonth.set(month, arr);
  }
  for (const arr of byMonth.values()) arr.sort((a, b) => String(a['timestamp']).localeCompare(String(b['timestamp'])));
  return { byMonth, dropped };
}

// ── The per-month write decision ─────────────────────────────────────────────────────

export type MonthAction = 'insert' | 'deepen' | 'unchanged' | 'skipped_would_shrink' | 'shrink_forced';

export interface MonthPlan {
  month:    string;
  stored:   number;
  incoming: number;
  action:   MonthAction;
  write:    boolean;
}

/**
 * Decide, per month, what the deep trawl may do — the whole of the "cannot regress"
 * guarantee, as a pure function.
 *
 * A month the trawl did not reach never appears here, so it is never touched. A month that
 * came back with FEWER posts than are stored is refused unless the operator forces it: the
 * oldest month of any deep trawl is partial by construction, and writing it would replace a
 * full stored month with the tail of one.
 */
export function planWrites(
  stored: Map<string, Array<Record<string, unknown>>>,
  incoming: Map<string, Array<Record<string, unknown>>>,
  allowShrink: boolean,
): MonthPlan[] {
  const plans: MonthPlan[] = [];
  for (const month of [...incoming.keys()].sort()) {
    const inc = incoming.get(month)!.length;
    const has = stored.get(month)?.length ?? 0;
    if (has === 0)  { plans.push({ month, stored: has, incoming: inc, action: 'insert',    write: true  }); continue; }
    if (inc > has)  { plans.push({ month, stored: has, incoming: inc, action: 'deepen',    write: true  }); continue; }
    if (inc === has){ plans.push({ month, stored: has, incoming: inc, action: 'unchanged', write: true  }); continue; }
    plans.push(allowShrink
      ? { month, stored: has, incoming: inc, action: 'shrink_forced',        write: true  }
      : { month, stored: has, incoming: inc, action: 'skipped_would_shrink', write: false });
  }
  return plans;
}

// ── The run ──────────────────────────────────────────────────────────────────────────

export interface DeepTrawlParams {
  db:           Db;
  clientId:     string;
  channel:      string;
  handle:       string;
  resultsLimit: number;
  apifyApiKey:  string;
  logger:       Logger;
  dryRun:       boolean;
  allowShrink:  boolean;
  timeoutMs?:   number;
}

export interface DeepTrawlResult {
  before:        TrawlSnapshot;
  after:         TrawlSnapshot;      // in a dry run, what the plan WOULD produce
  plans:         MonthPlan[];
  rawCount:      number;
  ownedCount:    number;
  droppedForeign:number;
  skippedHidden: number;
  droppedInvalid:number;
  unmappedTypes: Record<string, number>;
  wrote:         boolean;
}

export async function runDeepTrawl(params: DeepTrawlParams): Promise<DeepTrawlResult> {
  const { db, clientId, channel, handle, resultsLimit, apifyApiKey, logger, dryRun, allowShrink } = params;
  const logCtx = { clientId, channel, handle, resultsLimit, dryRun };

  const storedBefore = await readStored(db, clientId, channel);

  logger.info(logCtx, 'deep-trawl: calling Apify');
  const fetched = await fetchApifyPostsForHandle(
    handle, resultsLimit, apifyApiKey, logger, logCtx,
    { timeoutMs: params.timeoutMs ?? DEEP_TRAWL_TIMEOUT_MS },
  );

  // The account guard is the same one the routine trawl applies: zero owned posts means
  // the handle is wrong, and writing nothing is the only safe reading of that.
  if (fetched.ownedPosts.length === 0) {
    throw new Error(`deep-trawl: no posts owned by "${handle}" in ${fetched.rawCount} results — wrong handle? owners seen: ${fetched.distinctOtherOwners.join(', ') || '(none)'}`);
  }

  const unmappedTypes = tallyUnmappedMediaTypes(fetched.posts.map((p) => p.type));
  const unmappedCount = Object.values(unmappedTypes).reduce((s, n) => s + n, 0);
  if (unmappedCount > 0) {
    logger.warn({ ...logCtx, unmappedTypes, unmappedCount, ofPosts: fetched.posts.length },
      'deep-trawl: UNMAPPED Apify media type — stored without a mediaType and invisible to ' +
      'format derivation; add the raw value to mapApifyMediaType');
  }

  const { byMonth: incoming, dropped } = groupByLondonMonth(fetched.posts);
  const plans = planWrites(storedBefore, incoming, allowShrink);

  // The projected end state: stored months the trawl did not reach, plus every month it
  // will actually write. This is what `after` means in a dry run, and it is re-read from
  // the database rather than projected once a real run has happened.
  const projected = new Map(storedBefore);
  for (const p of plans) if (p.write) projected.set(p.month, incoming.get(p.month)!);

  if (!dryRun) {
    for (const p of plans) {
      if (!p.write) {
        logger.warn({ ...logCtx, month: p.month, stored: p.stored, incoming: p.incoming },
          'deep-trawl: SKIPPED — the trawl returned fewer posts for this month than are stored; ' +
          'writing would discard the difference (re-run with --allow-shrink to overrule)');
        continue;
      }
      const payload = incoming.get(p.month)! as Array<Record<string, unknown>>;
      igPostsArraySchema.parse(payload);   // fail loud rather than write a bad row
      await db.insert(igPosts)
        .values({ clientId, channel, month: p.month, posts: payload })
        .onConflictDoUpdate({ target: [igPosts.clientId, igPosts.channel, igPosts.month], set: { posts: payload, updatedAt: new Date() } });
      logger.info({ ...logCtx, month: p.month, action: p.action, stored: p.stored, incoming: p.incoming }, 'deep-trawl: wrote month');
    }
  }

  return {
    before:         summarise(storedBefore),
    after:          summarise(dryRun ? projected : await readStored(db, clientId, channel)),
    plans,
    rawCount:       fetched.rawCount,
    ownedCount:     fetched.ownedPosts.length,
    droppedForeign: fetched.droppedForeignCount,
    skippedHidden:  fetched.skippedHiddenCount,
    droppedInvalid: dropped,
    unmappedTypes,
    wrote:          !dryRun,
  };
}
