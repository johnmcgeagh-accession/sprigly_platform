/**
 * ai-change-usage.ts — how many AI changes a client has spent this month, and how many they get.
 *
 * ── Why this is in @sprigly/db ───────────────────────────────────────────────────────
 *
 * Two processes now have to agree about the allowance, and they are in different packages.
 * The APP checks it at the moment of spend (`app/src/lib/usage.ts`) and announces it before it
 * does the work; the WORKER checks it on the tick that releases banked work
 * (`engine/.../banked-changes.ts`). This is a number that decides whether the client is billed
 * and whether their post gets written, so two hand-written copies of the join is exactly the
 * kind of duplication that drifts and then disagrees about somebody's money.
 *
 * It is a pure DB read with no planning knowledge, which is the same reasoning that put
 * `plan-ready-claim.ts` and `sync-status.ts` here. It takes the db handle as a parameter so the
 * worker can pass its own injected one.
 *
 * ── The rules, stated ────────────────────────────────────────────────────────────────
 *
 * ONE CHANGE = one `post_edits` row with `passed = true`. That row is written by exactly the
 * paths that make a paid generation call and get a usable result back: a caption written for a
 * new post, an instructed caption rewrite (engine/.../shape.ts), a hook or script refine
 * (engine/.../refine.ts), and the weekly session's rewrites (engine/.../weekly-session.ts). A
 * generation that fails is not counted, because nothing was delivered.
 *
 * WHOSE ROW. `post_edits` has no client_id, so the count joins `cycle_id → content_cycles` and
 * filters on (client_id, channel). A client's Instagram allowance and their email allowance are
 * separate counts against separate limits.
 *
 * THE LIMIT is `client_channels.ai_change_limit`, per (client, channel). An
 * `ai_change_limit_override_until` in the future makes the channel unlimited until that instant.
 *
 * THE WINDOW is the calendar month in UTC, resetting on the 1st — see `monthWindowUtc`.
 */
import { and, eq, gte, sql as dsql } from 'drizzle-orm';
import { db as _db, clientChannels, contentCycles, postEdits } from './index.js';

type Db = typeof _db;

/**
 * The fallback when a client_channels row states no limit of its own. Named here so the app's
 * read, the worker's read and any operator-facing copy quote the same number.
 */
export const DEFAULT_AI_CHANGE_LIMIT = 30;

/**
 * The allowance window: the calendar month, in UTC, resetting on the 1st.
 *
 * UTC rather than Europe/London deliberately, and the difference shows up once a year: between
 * 00:00 and 01:00 BST on 1 July the two calendars disagree, so a London window would reset an
 * hour late. The reason UTC wins is the column — `post_edits.created_at` is a naive timestamp
 * written by the database, so counting against a London boundary would compare a UTC column to
 * a London instant and silently mis-count every summer. One clock, and it is the column's.
 */
export function monthWindowUtc(now: Date): { start: Date; resetsOn: Date } {
  return {
    start:    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),     1)),
    resetsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export interface AiChangeUsage {
  used:          number;
  limit:         number;
  overrideUntil: string | null;   // ISO, or null
  resetsOn:      string;          // ISO — first of next calendar month (UTC)
  unlimited:     boolean;         // override_until is in the future
}

/** Usage for an explicit client+channel. */
export async function readAiChangeUsage(
  db: Db, clientId: string, channel: string, now: Date = new Date(),
): Promise<AiChangeUsage> {
  const [ch] = await db
    .select({ limit: clientChannels.aiChangeLimit, overrideUntil: clientChannels.aiChangeLimitOverrideUntil })
    .from(clientChannels)
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
    .limit(1);

  const limit         = ch?.limit ?? DEFAULT_AI_CHANGE_LIMIT;
  const overrideUntil = ch?.overrideUntil ?? null;
  const unlimited     = overrideUntil != null && overrideUntil.getTime() > now.getTime();
  const { start, resetsOn } = monthWindowUtc(now);

  const [cnt] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(postEdits)
    .innerJoin(contentCycles, eq(postEdits.cycleId, contentCycles.id))
    .where(and(
      eq(contentCycles.clientId, clientId),
      eq(contentCycles.channel,  channel),
      eq(postEdits.passed, true),
      gte(postEdits.createdAt, start),
    ));

  return {
    used:          cnt?.n ?? 0,
    limit,
    overrideUntil: overrideUntil ? overrideUntil.toISOString() : null,
    resetsOn:      resetsOn.toISOString(),
    unlimited,
  };
}
