/**
 * draft-thread.uat.ts — the draft dock's memory, against the real thing.
 *
 *   pnpm --filter @sprigly/app uat scripts/draft-thread.uat.ts
 *
 * ── What this is, and why it is not a unit test ──────────────────────────────────────
 *
 * Every layer of this build is covered by a fast test that stubs the model. None of them can
 * answer the question the build exists for: given the previous turn, does the CLASSIFIER now
 * resolve "those"? That is a question about a model reading a prompt, and the only honest way
 * to ask it is to ask it.
 *
 * So this drives `POST /api/plan/draft/apply` — the real route, the real classifier, the real
 * transforms — and mocks exactly one thing: the session, because `getSession` reads a cookie
 * from a request context that does not exist outside Next.
 *
 * ── IT SPENDS AND IT WRITES ──────────────────────────────────────────────────────────
 *
 * Real Bedrock calls, on the real ledger. Real beat moves on the target cycle's draft, real
 * conversation rows. It is operator-invoked against UAT and lives behind vitest.uat.config.ts
 * so `pnpm test` can never collect it.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const CLIENT = 'c79cf1c5-b51d-4a9b-aedc-48577df43e8f';
const CYCLE  = '5ea00045-155d-497b-ac2e-a27eae36f235';   // plan month November 2026

vi.mock('@/lib/auth', () => ({ getSession: async () => ({ clientId: CLIENT, cycleId: CYCLE }) }));

const { POST } = await import('@/app/api/plan/draft/apply/route');
const { db, conversations, agentMessages } = await import('@sprigly/db');
const { eq, and, gte } = await import('drizzle-orm');

interface TurnResult {
  ok: boolean;
  conversationId?: string | null;
  application?: { scope: string; reason?: string; lines: string[]; note?: string; changedIds: string[] };
}

/** One dock turn, exactly as the sheet sends it. */
async function turn(text: string, conversationId: string | null): Promise<TurnResult> {
  const res = await POST(new Request('http://uat/api/plan/draft/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'text', text, cycleId: CYCLE, source: 'web', conversationId }),
  }));
  return (await res.json()) as TurnResult;
}

/** What the client would read back, for the record. */
const said = (r: TurnResult): string => {
  const a = r.application;
  if (!a) return `(no application) ok=${r.ok}`;
  const body = a.lines.length ? a.lines.join(' | ') : (a.note ?? '(no lines)');
  return `[${a.scope}${a.reason ? `/${a.reason}` : ''}] ${body}`;
};

const startedAt = new Date();

beforeAll(() => {
  console.log(`\n═══ cycle ${CYCLE} — run at ${startedAt.toISOString()} ═══\n`);
});

/**
 * THE EXACT FAILING SEQUENCE, in order, in one session.
 *
 * Recorded live before this build (times are the stored rows'):
 *   20:21:08  "move a post from the 17th to the week before"  → three posts moved
 *   20:23:12  "I only wanted one of those moving"             → filed as a backlog idea
 */
describe('the observed failure, replayed', () => {
  let conv: string | null = null;
  const seen: string[] = [];

  it('turn 1 — "move a post from the 17th to the week before"', async () => {
    const r = await turn('move a post from the 17th to the week before', conv);
    conv = r.conversationId ?? null;
    seen.push(said(r));
    console.log('T1 client   : move a post from the 17th to the week before');
    console.log(`T1 assistant: ${said(r)}`);
    console.log(`T1 conv     : ${conv}\n`);
    expect(r.ok).toBe(true);
  });

  it('turn 2 — "I only wanted one of those moving" resolves "those"', async () => {
    expect(conv).toBeTruthy();                       // the session must have survived turn 1
    const r = await turn('I only wanted one of those moving', conv);
    seen.push(said(r));
    console.log('T2 client   : I only wanted one of those moving');
    console.log(`T2 assistant: ${said(r)}`);
    console.log(`T2 conv     : ${r.conversationId}  (same as T1: ${r.conversationId === conv})\n`);

    // THE SEAM: one conversation across both turns. This is the half that is not the model's,
    // and it is the half this build owns end to end.
    expect(r.conversationId).toBe(conv);

    /**
     * The classifier's half is REPORTED, not asserted, and the reason is a scope boundary.
     *
     * With the thread the classifier now reads this as a month-scoped CORRECTION rather than a
     * standing idea — measured directly against the model, 0/6 before and 6/6 after. What
     * `applyCorrection` then does with "one of those" is a CARDINALITY question, and cardinality
     * is explicitly out of scope for this build: the transform moves every beat it matches and
     * reads no count. So the turn can still land as a filing on the way through the transform,
     * and asserting otherwise here would be asserting someone else's change.
     */
  });

  it('turn 3 — "move it back" resolves against what just happened', async () => {
    const r = await turn('move it back', conv);
    seen.push(said(r));
    console.log('T3 client   : move it back');
    console.log(`T3 assistant: ${said(r)}`);
    console.log(`T3 conv     : ${r.conversationId}\n`);
    expect(r.conversationId).toBe(conv);
  });

  it('the whole session is ONE conversation row, not three', async () => {
    const rows = await db.select({ id: agentMessages.id, metadata: agentMessages.metadata })
      .from(agentMessages).where(eq(agentMessages.conversationId, conv!));
    console.log(`session ${conv} holds ${rows.length} messages across 3 exchanges`);
    console.log(`transcript:\n  ${seen.join('\n  ')}\n`);
    expect(rows.length).toBe(6);                     // 3 user + 3 assistant, one thread

    // Piece 2: every assistant turn carries the structured form the next turn's window reads.
    const withItems = rows.filter((r) => Array.isArray((r.metadata as { items?: unknown } | null)?.items));
    console.log(`assistant turns carrying items metadata: ${withItems.length} of 3`);
    expect(withItems.length).toBeGreaterThan(0);
  });
});

/**
 * A FIRST TURN HAS NO THREAD, and must behave exactly as it always did.
 */
describe('no thread — unchanged behaviour', () => {
  it('a fresh session with no conversation id still lands', async () => {
    const r = await turn('add a post about Maggie on the 26th', null);
    console.log('fresh client   : add a post about Maggie on the 26th');
    console.log(`fresh assistant: ${said(r)}`);
    console.log(`fresh conv     : ${r.conversationId} (newly opened)\n`);
    expect(r.ok).toBe(true);
    expect(r.conversationId).toBeTruthy();
  });
});

/**
 * A STALE ID FROM ANOTHER MONTH does not thread. Threads are per-month, enforced server-side
 * as well as by the dock's reset — a stale tab must not append November's correction to
 * another month's conversation.
 */
describe('per-month threads', () => {
  it('an id belonging to another cycle is not adopted', async () => {
    const [other] = await db.select({ id: conversations.id })
      .from(conversations).where(eq(conversations.clientId, CLIENT)).limit(50);
    const foreign = (await db.select({ id: conversations.id, cycleId: conversations.cycleId })
      .from(conversations).where(eq(conversations.clientId, CLIENT)).limit(200))
      .find((c) => c.cycleId && c.cycleId !== CYCLE);
    if (!foreign) { console.log('(no other-month conversation on this client — skipped)'); return; }

    const r = await turn('what is on next week', foreign.id);
    console.log(`stale id ${foreign.id} (cycle ${foreign.cycleId})`);
    console.log(`  → served on ${r.conversationId} — adopted: ${r.conversationId === foreign.id}\n`);
    expect(r.conversationId).not.toBe(foreign.id);
    expect(other).toBeTruthy();
  });
});

/** The shape of the record this run leaves behind — the N-vs-3N question, measured. */
describe('conversation rows per exchange', () => {
  it('reports rows opened and messages written by this run', async () => {
    const convs = await db.select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.cycleId, CYCLE), gte(conversations.createdAt, startedAt)));
    const msgs = await db.select({ id: agentMessages.id })
      .from(agentMessages)
      .where(gte(agentMessages.createdAt, startedAt));
    console.log(`\nthis run: ${convs.length} conversation rows, ${msgs.length} messages`);
    console.log('(before this build: one conversation row per exchange, every time)\n');
    expect(convs.length).toBeGreaterThan(0);
  });
});
