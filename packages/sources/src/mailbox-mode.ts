import { db as _db, oauthConnections, routingRules } from '@sprigly/db';
import { and, eq } from 'drizzle-orm';

type Db = typeof _db;

// BACKLOG: inbox-agent phase — replace noop target with the triage agent workflow.
const NOOP_WORKFLOW_ID = 'sprigly-inbox-noop';

/**
 * Switch a mailbox's polling mode atomically. A single transaction covers:
 *   1. Updates polling_mode on the OAuth connection (keyed on connection id).
 *   2. Resets last_polled_at = NOW() so no pre-switch emails are reprocessed.
 *   3. full  → ensures an enabled auto-created match-all fallback rule exists,
 *              targeting the noop workflow. Re-enables if previously disabled.
 *      selective → disables the auto-created fallback rule (disable not delete,
 *              so switching back is clean and audit history is preserved).
 *
 * Only rules with autoCreated = true are ever touched. Manually authored rules
 * (autoCreated = false) are never modified, disabled, or deleted by this function.
 *
 * BACKLOG: routing rules are managed at clientId scope (one fallback rule per
 * client). This does not handle multiple mailboxes of the same provider for a
 * single client correctly — switching one mailbox affects the fallback rule for
 * all. Re-scope rules to connection id before supporting multi-mailbox-per-client.
 */
export async function switchPollingMode(
  db: Db,
  connectionId: string,
  newMode: 'selective' | 'full',
): Promise<void> {
  await db.transaction(async (tx) => {
    // ── 1. Update connection: mode + watermark reset ──────────────────────────
    // Keyed on connection id (unambiguous). RETURNING gives us clientId for the
    // rules management step without a separate SELECT.
    const updated = await tx
      .update(oauthConnections)
      .set({ pollingMode: newMode, lastPolledAt: new Date(), updatedAt: new Date() })
      .where(eq(oauthConnections.id, connectionId))
      .returning({ clientId: oauthConnections.clientId });

    const clientId = updated[0]?.clientId;
    if (clientId === undefined) return; // no row matched — no-op

    if (newMode === 'full') {
      // ── 2. Ensure match-all fallback rule exists and is enabled ─────────────
      // Query regardless of enabled state so a prior-disabled auto-created rule
      // is re-enabled rather than duplicated.
      const existing = await tx
        .select({ id: routingRules.id })
        .from(routingRules)
        .where(
          and(
            eq(routingRules.clientId, clientId),
            eq(routingRules.source, 'email'),
            eq(routingRules.autoCreated, true),
            eq(routingRules.isFallback, true),
          ),
        )
        .limit(1);

      if (existing[0] !== undefined) {
        await tx
          .update(routingRules)
          .set({ enabled: true, updatedAt: new Date() })
          .where(eq(routingRules.id, existing[0].id));
      } else {
        await tx.insert(routingRules).values({
          clientId,
          source:           'email',
          matchConditions:  [],
          workflowId:       NOOP_WORKFLOW_ID,
          destinations:     [],
          priority:         0,
          enabled:          true,
          isFallback:       true,
          autoCreated:      true,
          clientConfigId:   null,
        });
      }
    } else {
      // ── 3. Disable the auto-created fallback rule on switch to selective ─────
      await tx
        .update(routingRules)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(routingRules.clientId, clientId),
            eq(routingRules.source, 'email'),
            eq(routingRules.autoCreated, true),
            eq(routingRules.isFallback, true),
          ),
        );
    }
  });
}
