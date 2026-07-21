/**
 * plan-activity.integration.test.ts — DB-backed proof that a manual edit and an
 * approved agent proposal land in plan_activity as ONE ordered stream (AUDIT.md §3),
 * and that the ledger is genuinely append-only at the DB layer.
 *
 * Requires a real Postgres. Skipped cleanly when TEST_DATABASE_URL is unset, so the
 * normal mocked suite stays offline-green — every db-bound import is dynamic, inside
 * the guarded block, so nothing touches @sprigly/db (and its DATABASE_URL parse) when
 * skipped.
 *
 * Run against the disposable local container:
 *   ./scripts/test-db.sh up
 *   DATABASE_URL="$(./scripts/test-db.sh url)" TEST_DATABASE_URL="$(./scripts/test-db.sh url)" \
 *     pnpm --filter @sprigly/app exec vitest run src/lib/plan-activity.integration.test.ts
 *   ./scripts/test-db.sh destroy
 */
import { describe, it, expect, beforeAll } from 'vitest';

const TEST_DB = process.env['TEST_DATABASE_URL'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Dates relative to the RUN date, not the authoring date.
 *
 * These fixtures pass through the real date gate (isEditableDate, which defaults today to
 * editScopeToday()), so a hardcoded literal is only "a future date" until the calendar
 * reaches it. This file's move-to date was 2026-07-20: it passed on the 20th and failed on
 * the 21st. Anchoring to the 1st of next month keeps every fixture date future and inside
 * one month whenever the suite runs.
 */
function nextMonthStart(todayIso: string): string {
  const [y, m] = todayIso.split('-').map(Number);
  return m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, '0')}-01`;
}
const plusDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);


describe.skipIf(!TEST_DB)('plan_activity ledger (integration — requires TEST_DATABASE_URL)', () => {
  let db: Any, S: Any, d: Any, mutations: Any, proposals: Any;
  // Anchored to the same 'today' the gate reads, so the fixture and the guard agree.
  let seedDate: string, moveDate: string, proposalDate: string, cycleMonth: string;

  beforeAll(async () => {
    S = await import('@sprigly/db');          // real schema + db (bound to DATABASE_URL = the container)
    db = S.db;
    d = await import('drizzle-orm');
    mutations = await import('@/lib/mutations');
    proposals = await import('@/lib/agent/proposals');

    const { editScopeToday } = await import('@/lib/edit-scope');
    const base   = nextMonthStart(editScopeToday());
    seedDate     = base;                       // the post's original slot
    moveDate     = plusDays(base, 5);          // the manual PATCH target
    proposalDate = plusDays(base, 10);         // the approved proposal's target
    // A cycle plans the month AFTER its own, and these dates live in next month.
    cycleMonth   = editScopeToday().slice(0, 7);
  });

  it('a manual PATCH and an approved proposal form one ordered stream; the ledger is append-only', async () => {
    const uniq = `it-${Date.now()}`;

    // ── seed: client → cycle → post ──────────────────────────────────────────
    const [{ id: clientId }] = await db.insert(S.clients)
      .values({ name: 'Integration Test', slug: uniq }).returning({ id: S.clients.id });
    const [{ id: cycleId }] = await db.insert(S.contentCycles)
      .values({ clientId, channel: 'instagram', cycleMonth }).returning({ id: S.contentCycles.id });
    const [{ id: postId }] = await db.insert(S.contentCyclePosts)
      .values({ clientId, cycleId, channel: 'instagram', scheduledDate: seedDate, format: 'reel', caption: 'seed' })
      .returning({ id: S.contentCyclePosts.id });

    // ── manual edit (origin=user) ────────────────────────────────────────────
    await mutations.patchPost(clientId, cycleId, postId, { date: moveDate });

    // ── approved agent proposal (origin=agent) ───────────────────────────────
    const [{ id: conversationId }] = await db.insert(S.conversations)
      .values({ clientId, cycleId }).returning({ id: S.conversations.id });
    const [{ id: messageId }] = await db.insert(S.agentMessages)
      .values({ conversationId, role: 'user', content: `move it to ${proposalDate}` }).returning({ id: S.agentMessages.id });
    const proposal = await proposals.createProposal({
      clientId, conversationId, messageId, changeSetId: crypto.randomUUID(),
      action: 'move_post',
      payload: { kind: 'move', cycleId, postId, toDate: proposalDate },
      summary: `Move the post to ${proposalDate}`,
    });
    const approved = await proposals.approveProposal(clientId, proposal.id, 'integration');
    expect(approved.proposal?.status).toBe('applied');

    // ── assert: one ordered stream, both actors ──────────────────────────────
    const rows = await db.select().from(S.planActivity)
      .where(d.eq(S.planActivity.clientId, clientId))
      .orderBy(d.asc(S.planActivity.createdAt));

    expect(rows.map((r: Any) => r.origin)).toEqual(['user', 'agent']);
    expect(rows[0]).toMatchObject({ action: 'rescheduled', origin: 'user', postId, refProposalId: null });
    expect(rows[1]).toMatchObject({ action: 'rescheduled', origin: 'agent', postId, refProposalId: proposal.id });

    // ── assert: append-only is enforced at the DB layer ──────────────────────
    await expect(
      db.execute(d.sql`update plan_activity set action = 'tampered' where id = ${rows[0].id}`),
    ).rejects.toThrow(/append-only/i);
    await expect(
      db.execute(d.sql`delete from plan_activity where id = ${rows[0].id}`),
    ).rejects.toThrow(/append-only/i);
  });
});
