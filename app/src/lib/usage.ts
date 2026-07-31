/**
 * usage.ts — AI-change limits & usage (Phase 4), as the APP sees them.
 *
 * ONLY AI changes count: rewrites/regen and AI caption-gen for new drafts (every `post_edits`
 * row). Structural edits — move, reorder, add-blank, a manual caption, the agent's structural
 * commands — are free and never counted or blocked.
 *
 * ── The read moved, and why (X2) ─────────────────────────────────────────────────────
 *
 * The count and the limit now live in `@sprigly/db` (`ai-change-usage.ts`), which states the
 * rules in full; what they MEAN lives in `@sprigly/engine/ai-change-cap`. This file is what the
 * app calls, and nothing more.
 *
 * The reason is that a SECOND process reads the same allowance: the worker's banked-run trigger,
 * which releases the work the cap refused once the month resets. Two hand-written copies of a
 * join that decides whether a client is billed is exactly the duplication that drifts and then
 * disagrees about somebody's money — and the boundary they would drift on, the reset instant, is
 * the one place a difference stays invisible until the 1st.
 */
import { and, eq } from 'drizzle-orm';
import { db, contentCycles, readAiChangeUsage, type AiChangeUsage } from '@sprigly/db';
import { isCapReached, remainingChanges } from '@sprigly/engine/ai-change-cap';

export type UsageInfo = AiChangeUsage;

/** Usage for an explicit client+channel. */
export async function getUsage(clientId: string, channel: string): Promise<UsageInfo> {
  return readAiChangeUsage(db, clientId, channel);
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
  return isCapReached(usage);
}

/**
 * How many AI changes are left this month — the number the agent ANNOUNCES before it does the
 * work (X2a). `Infinity` under an active override, which is why every caller checks `unlimited`
 * before printing anything: an unlimited client is never given a count.
 */
export function remainingAiChanges(usage: UsageInfo): number {
  return remainingChanges(usage);
}
