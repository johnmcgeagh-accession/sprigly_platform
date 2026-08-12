/**
 * draft-cardinality.uat.ts — the failing sequence, end to end, as the client sees it.
 *
 *   pnpm --filter @sprigly/app uat scripts/draft-cardinality.uat.ts
 *
 * The selection logic is covered purely (correction-cardinality.test.ts) and against the real
 * month without writing (scripts/cardinality-cases.mts). What neither can show is the thing
 * this build is actually for: two turns in one conversation, the second correcting the first,
 * and what the dock says back.
 *
 * Mocks the session only. Real classifier, real transforms, real writes to the target cycle,
 * real Bedrock spend. Behind vitest.uat.config.ts so `pnpm test` cannot collect it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';

const CLIENT = 'c79cf1c5-b51d-4a9b-aedc-48577df43e8f';
const CYCLE  = '5ea00045-155d-497b-ac2e-a27eae36f235';   // plan month November 2026

vi.mock('@/lib/auth', () => ({ getSession: async () => ({ clientId: CLIENT, cycleId: CYCLE }) }));

const { POST } = await import('@/app/api/plan/draft/apply/route');
const { db, contentCyclePosts, contentCycles } = await import('@sprigly/db');
const { and, eq, isNull } = await import('drizzle-orm');

interface TurnResult {
  ok: boolean;
  conversationId?: string | null;
  application?: { scope: string; reason?: string; lines: string[]; note?: string; changedIds: string[] };
}

async function turn(text: string, conversationId: string | null): Promise<TurnResult> {
  const res = await POST(new Request('http://uat/api/plan/draft/apply', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'text', text, cycleId: CYCLE, source: 'web', conversationId }),
  }));
  return (await res.json()) as TurnResult;
}

/** What the dock renders for this turn: the diff lines. The note lands in the receipt panel. */
const dock = (r: TurnResult) => r.application?.lines?.length
  ? r.application.lines.join('\n              ')
  : `(no lines — ${r.application?.scope}${r.application?.reason ? `/${r.application.reason}` : ''})`;

/** The beats on a date, in the order the client sees them. */
async function onDate(date: string) {
  const rows = await db.select({
    id: contentCyclePosts.id, position: contentCyclePosts.position, sourceMeta: contentCyclePosts.sourceMeta,
  }).from(contentCyclePosts).where(and(
    eq(contentCyclePosts.cycleId, CYCLE), eq(contentCyclePosts.scheduledDate, date),
    eq(contentCyclePosts.status, 'draft'), isNull(contentCyclePosts.deletedAt),
  ));
  return rows.sort((a, b) => a.position - b.position)
    .map((r) => (typeof r.sourceMeta?.['title'] === 'string' ? r.sourceMeta['title'] as string : '(untitled)'));
}

const status = async () => (await db.select({ s: contentCycles.status })
  .from(contentCycles).where(eq(contentCycles.id, CYCLE)))[0]?.s;

/** The date the sequence runs on, and the one it moves to. */
const FROM = '2026-11-12';
const TO   = '2026-11-05';

beforeAll(async () => {
  console.log(`\n═══ cycle ${CYCLE} ═══`);
  console.log(`status BEFORE: ${await status()}`);
  console.log(`${FROM} BEFORE: ${(await onDate(FROM)).length} — ${(await onDate(FROM)).join(' / ')}`);
  console.log(`${TO} BEFORE: ${(await onDate(TO)).length} — ${(await onDate(TO)).join(' / ') || '(empty)'}\n`);
});

afterAll(async () => {
  console.log(`\n${FROM} AFTER: ${(await onDate(FROM)).length} — ${(await onDate(FROM)).join(' / ') || '(empty)'}`);
  console.log(`${TO} AFTER: ${(await onDate(TO)).length} — ${(await onDate(TO)).join(' / ') || '(empty)'}`);
  console.log(`status AFTER: ${await status()}\n`);
});

/**
 * THE ORIGINAL FAILING SEQUENCE.
 *
 * Recorded live before any of this work:
 *   "move a post from the 17th to the week before"  → three posts moved
 *   "I only wanted one of those moving"             → filed as a backlog idea
 */
describe('the failing sequence, end to end', () => {
  let conv: string | null = null;

  it('turn 1 — a singular ask moves ONE of the three', async () => {
    const before = await onDate(FROM);
    expect(before.length).toBeGreaterThanOrEqual(2);   // the case needs a crowded date

    const r = await turn(`move a post from the 12th to the 5th`, conv);
    conv = r.conversationId ?? null;
    console.log(`T1 client   : move a post from the 12th to the 5th`);
    console.log(`T1 dock     : ${dock(r)}`);
    console.log(`T1 receipt  : ${r.application?.note ?? '(no note)'}`);
    console.log(`T1 conv     : ${conv}\n`);

    expect(r.ok).toBe(true);
    // ONE line, not three. This is the whole change.
    expect(r.application?.lines).toHaveLength(1);
    expect(await onDate(FROM)).toHaveLength(before.length - 1);
  });

  it('turn 2 — "I only wanted one of those moving" against a turn that already moved one', async () => {
    const r = await turn('I only wanted one of those moving', conv);
    console.log(`T2 client   : I only wanted one of those moving`);
    console.log(`T2 dock     : ${dock(r)}`);
    console.log(`T2 receipt  : ${r.application?.note ?? '(no note)'}`);
    console.log(`T2 conv     : ${r.conversationId} (same as T1: ${r.conversationId === conv})\n`);

    expect(r.conversationId).toBe(conv);
    // Reported, not asserted: turn 1 already did what they wanted, so the honest outcome for
    // turn 2 is context-dependent and is printed above rather than pinned to one sentence.
  });
});

/** The plural and unqualified asks, on the same live month. */
describe('plural and unqualified still move everything', () => {
  it('"move the posts from the 15th to the 14th" moves all of them', async () => {
    const before = await onDate('2026-11-15');
    const r = await turn('move the posts from the 15th to the 14th', null);
    console.log(`client  : move the posts from the 15th to the 14th`);
    console.log(`dock    : ${dock(r)}`);
    console.log(`receipt : ${r.application?.note ?? '(no note)'}\n`);
    expect(r.application?.lines).toHaveLength(before.length);
    expect(await onDate('2026-11-15')).toHaveLength(0);
  });
});
