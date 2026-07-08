/**
 * ledger.integration.test.ts — worker-level proof that the deviation-3 ledger helper
 * writes agent-authored plan_activity rows (caption_saved / script_saved, origin=agent,
 * ref_proposal_id when an approved proposal drove it), and that the ledger stays
 * append-only at the DB layer. The e2e fakes bypass the real worker, so this is where
 * the emission is actually verified — same harness as
 * app/src/lib/plan-activity.integration.test.ts.
 *
 * Requires a real Postgres. Skipped cleanly when TEST_DATABASE_URL is unset (every
 * db-bound import is dynamic inside the guarded block), so the mocked suite stays
 * offline-green.
 *
 *   ./scripts/test-db.sh up
 *   DATABASE_URL="$(./scripts/test-db.sh url)" TEST_DATABASE_URL="$(./scripts/test-db.sh url)" \
 *     pnpm --filter @sprigly/worker exec vitest run src/content-cycles/ledger.integration.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';

const TEST_DB = process.env['TEST_DATABASE_URL'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe.skipIf(!TEST_DB)('worker plan_activity ledger (integration — requires TEST_DATABASE_URL)', () => {
  let S: Any, db: Any, d: Any, ledger: Any;

  beforeAll(async () => {
    S = await import('@sprigly/db');
    db = S.db;
    d = await import('drizzle-orm');
    ledger = await import('./ledger.js');
  });

  it('worker writes caption_saved + script_saved as origin=agent with ref_proposal_id; append-only holds', async () => {
    const uniq = `wk-${Date.now()}`;

    const [{ id: clientId }] = await db.insert(S.clients)
      .values({ name: 'Worker Ledger IT', slug: uniq }).returning({ id: S.clients.id });
    const [{ id: cycleId }] = await db.insert(S.contentCycles)
      .values({ clientId, channel: 'instagram', cycleMonth: '2026-07' }).returning({ id: S.contentCycles.id });
    const [{ id: postId }] = await db.insert(S.contentCyclePosts)
      .values({ clientId, cycleId, channel: 'instagram', scheduledDate: '2026-07-15', format: 'reel', caption: 'seed', hook: 'seed hook' })
      .returning({ id: S.contentCyclePosts.id });

    // A proposal so caption_saved can carry ref_proposal_id (the approved-proposal path).
    const [{ id: convId }] = await db.insert(S.conversations).values({ clientId, cycleId }).returning({ id: S.conversations.id });
    const [{ id: msgId }] = await db.insert(S.agentMessages).values({ conversationId: convId, role: 'user', content: 'move it', source: 'web' }).returning({ id: S.agentMessages.id });
    const [{ id: proposalId }] = await db.insert(S.agentProposals)
      .values({ clientId, conversationId: convId, messageId: msgId, intent: 'shape', payload: {}, summary: 'x', status: 'applied' })
      .returning({ id: S.agentProposals.id });

    // Deviation-3: the shape worker's caption write (origin agent + ref_proposal_id) …
    await ledger.recordPlanActivity(db, {
      clientId, cycleId, postId,
      action: 'caption_saved', actor: { origin: 'agent', refProposalId: proposalId },
    });
    // … and the script worker's row (origin agent, no proposal), from day one.
    await ledger.recordPlanActivity(db, {
      clientId, cycleId, postId,
      action: 'script_saved', actor: { origin: 'agent' }, payload: { lengthSeconds: 30 },
    });

    const rows = await db.select().from(S.planActivity).where(d.eq(S.planActivity.postId, postId));
    const captionRow = rows.find((r: Any) => r.action === 'caption_saved');
    const scriptRow  = rows.find((r: Any) => r.action === 'script_saved');

    expect(captionRow?.origin).toBe('agent');
    expect(captionRow?.refProposalId).toBe(proposalId);
    expect(scriptRow?.origin).toBe('agent');
    expect(scriptRow?.refProposalId).toBeNull();
    expect(scriptRow?.payload).toMatchObject({ lengthSeconds: 30 });

    // Append-only: the 0068 trigger blocks UPDATE and DELETE.
    await expect(
      db.update(S.planActivity).set({ action: 'tampered' }).where(d.eq(S.planActivity.id, captionRow.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(S.planActivity).where(d.eq(S.planActivity.id, scriptRow.id)),
    ).rejects.toThrow();
  });
});
