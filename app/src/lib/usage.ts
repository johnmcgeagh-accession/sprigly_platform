/**
 * usage.ts — AI-change limits & usage (Phase 4). ONLY AI changes count: rewrites/
 * regen and AI caption-gen for new drafts (every row in post_edits). Structural
 * edits (move/reorder/add-blank/manual caption + structural agent-bar commands) are
 * free and never counted or blocked.
 *
 * Used  = post_edits rows for the client+channel in the CURRENT calendar month
 *         (resets on the 1st). post_edits has no client_id, so join via cycle_id →
 *         content_cycles (client_id + channel).
 * Limit = client_channels.ai_change_limit; an override_until in the future ⇒ unlimited.
 */
import { and, eq, gte, sql as dsql } from 'drizzle-orm';
import { db, clientChannels, contentCycles, postEdits } from '@sprigly/db';

export interface UsageInfo {
  used:          number;
  limit:         number;
  overrideUntil: string | null;   // ISO, or null
  resetsOn:      string;          // ISO — first of next calendar month (UTC)
  unlimited:     boolean;         // override_until is in the future
}

/** UTC month window: [start of this month, start of next month). */
function monthWindow(now: Date): { start: Date; resetsOn: Date } {
  return {
    start:    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),     1)),
    resetsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** Usage for an explicit client+channel. */
export async function getUsage(clientId: string, channel: string): Promise<UsageInfo> {
  const [ch] = await db
    .select({ limit: clientChannels.aiChangeLimit, overrideUntil: clientChannels.aiChangeLimitOverrideUntil })
    .from(clientChannels)
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
    .limit(1);

  const limit         = ch?.limit ?? 30;
  const overrideUntil = ch?.overrideUntil ?? null;
  const now           = new Date();
  const unlimited     = overrideUntil != null && overrideUntil.getTime() > now.getTime();
  const { start, resetsOn } = monthWindow(now);

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

/** Usage for a session cycle — resolves the channel from the cycle row first. */
export async function getUsageForCycle(clientId: string, cycleId: string): Promise<UsageInfo> {
  const [cyc] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  return getUsage(clientId, cyc?.channel ?? 'instagram');
}

/** True when a rewrite must be soft-blocked (at/over limit and no active override). */
export function isRewriteBlocked(usage: UsageInfo): boolean {
  return !usage.unlimited && usage.used >= usage.limit;
}
