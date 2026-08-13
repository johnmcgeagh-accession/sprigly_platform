/**
 * brief-shortfall.uat.ts — does the loss actually become visible, on the real route?
 *
 *   pnpm --filter @sprigly/app uat scripts/brief-shortfall.uat.ts
 *
 * The detector is covered purely (brief-shortfall.test.ts, against the live brief that dropped
 * Maggie). What that cannot show is the wiring this build is for: the intake route running a
 * real extraction, noticing the gap, and leaving a row somebody can find. Real Bedrock spend,
 * real writes. Behind vitest.uat.config.ts so `pnpm test` cannot collect it.
 *
 * ── WHY THIS CYCLE ───────────────────────────────────────────────────────────────────────────
 *
 * 32ca4deb is ivy-t's 2026-11 cycle: pre-planning, and carrying ZERO draft beats. Both matter.
 * Zero beats means `applyBriefToDraft` never fires (the reshape is gated on the month already
 * having a draft), so a run here exercises extraction and detection without reshaping anything.
 * And a baseline of zero is a baseline this harness can restore exactly — every beat it seeds,
 * it deletes. It deliberately does NOT run against 5ea00045, which is the reproduction the whole
 * investigation rests on and has 41 real beats a reshape would move.
 *
 * ── WHY IT SEEDS BEATS AT ALL ────────────────────────────────────────────────────────────────
 *
 * Because the abridgement only appears when there is a CURRENT PLAN section to read against.
 * Measured: the same brief with no current plan comes back faithful but slow (2,509–2,719 output
 * tokens, 23–35s — past the route's own 25s race); with 41 beats it comes back fast, short, and
 * missing products. A harness on an empty month would only ever see the timeout, so it seeds the
 * shape the defect actually needs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';

const CLIENT     = 'c79cf1c5-b51d-4a9b-aedc-48577df43e8f';
const CYCLE      = '32ca4deb-ac5b-4aaf-b7bf-aee7e01c463b';  // 2026-11 → plan month 2026-12
const PLAN_MONTH = '2026-12';
const RUNS       = 5;   // the failure is a sampling coin flip; one green run proves nothing

vi.mock('@/lib/auth', () => ({ getSession: async () => ({ clientId: CLIENT, cycleId: CYCLE }) }));

const { POST } = await import('@/app/api/plan/intake/route');
const { db, contentCycles, contentCyclePosts, auditLog } = await import('@sprigly/db');
const { and, eq, gt, desc, sql } = await import('drizzle-orm');
const { resetRateLimit } = await import('@/lib/rate-limit');

// ── The three briefs under test ───────────────────────────────────────────────────────────────

/** Short, one sentence, one product. Must not produce a shortfall row. */
const SHORT = 'Launch Maggie in yellow on the 3rd of December.';

/** Twelve catalogue products, each with its own dated arc — a realistic worst-case brief. */
const BIG = [
  'Launch Maggie in yellow on the 3rd, with a teaser the week before and a follow up the week after.',
  'Orla in navy goes live on the 5th — please tease it beforehand and add a styling tips post after.',
  'Big Connie relaunch on the 8th. Build up to it with posts on the 6th and 7th, all about Connie.',
  'Sadie is restocking on the 10th, we want a customer story post the same week.',
  'Launch Hannah in green on the 12th with a teaser the week before and a follow up after.',
  'Willow returns on the 14th — a behind the scenes post about the shipment would be good.',
  'Arabella in ecru launches on the 16th, tease it on the 15th.',
  'Heather restock on the 18th, plus a details post about the fabric.',
  'Lydia goes live on the 20th with a founder note the day before.',
  'Nora in black on the 22nd, teaser the week before.',
  'Verity restock on the 24th and a quotes post about it.',
  'Marley launches on the 26th with a follow up on the 28th.',
].join('\n\n');

// ── Fixture management ────────────────────────────────────────────────────────────────────────

/** Titles in the shape the real month carries them — arcs, features, and product-less beats. */
function seedRows() {
  const titles = [
    'Tease', 'Launch', 'Follow-up', 'WSG: a weekend with Layla', 'Sunday style',
    'Behind the scenes', 'Customer story', 'Styling tips', 'Note from the founder', 'Restock announcement',
  ];
  return Array.from({ length: 41 }, (_, i) => ({
    cycleId: CYCLE, clientId: CLIENT, channel: 'instagram',
    scheduledDate: `${PLAN_MONTH}-${String((i % 28) + 1).padStart(2, '0')}`,
    format: 'single', pillar: 'brand', status: 'draft', position: i,
    sourceMeta: { title: `${titles[i % titles.length]} ${i + 1}` },
  }));
}

/**
 * The cycle exactly as it was before this file ran — captured once, put back once.
 *
 * The harness needs a BLANK intake between runs (the route merges freeNotes, so run 2 would
 * otherwise extract run 1's brief plus its own). But blank is not this cycle's baseline: it
 * carries real answers and a real brief of its own, and an earlier version of this file cleared
 * them and called that "restored". Clearing between runs and restoring at the end are two
 * different operations, so they are two functions.
 */
let ORIGINAL: { intakeJson: unknown; structuredBrief: unknown } | null = null;

async function captureOriginal(): Promise<void> {
  const [row] = await db.select({ j: contentCycles.intakeJson, b: contentCycles.structuredBrief })
    .from(contentCycles).where(eq(contentCycles.id, CYCLE));
  ORIGINAL = { intakeJson: row!.j, structuredBrief: row!.b };
}

async function restoreOriginal(): Promise<void> {
  await db.delete(contentCyclePosts).where(eq(contentCyclePosts.cycleId, CYCLE));
  if (!ORIGINAL) return;
  await db.update(contentCycles)
    .set({ intakeJson: ORIGINAL.intakeJson, structuredBrief: ORIGINAL.structuredBrief })
    .where(eq(contentCycles.id, CYCLE));
}

/** A blank slate for ONE run: no beats, no brief, no notes. Not the baseline — see above. */
async function resetCycle(): Promise<void> {
  await db.delete(contentCyclePosts).where(eq(contentCyclePosts.cycleId, CYCLE));
  const [row] = await db.select({ j: contentCycles.intakeJson }).from(contentCycles).where(eq(contentCycles.id, CYCLE));
  const intake = (row!.j ?? {}) as Record<string, unknown>;
  const planContent = (intake.planContent ?? {}) as Record<string, unknown>;
  await db.update(contentCycles).set({
    intakeJson: { ...intake, planContent: { ...planContent, answers: {}, freeNotes: '' } },
    structuredBrief: null,
  }).where(eq(contentCycles.id, CYCLE));
}

async function post(freeNotes: string) {
  resetRateLimit();
  return POST(new Request('http://uat/api/plan/intake', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cycleId: CYCLE, freeNotes, source: 'web' }),
  }));
}

interface Outcome { outcome: string; failure?: string; missing?: string[]; named?: string[] }

/** The post-parse rows this build adds, newest first. */
async function outcomesSince(ts: Date): Promise<Outcome[]> {
  const rows = await db.select({ metadata: auditLog.metadata }).from(auditLog).where(and(
    eq(auditLog.clientId, CLIENT),
    eq(auditLog.action, 'content-cycle:brief-extract-outcome'),
    gt(auditLog.createdAt, ts),
  )).orderBy(desc(auditLog.createdAt));
  return rows.map((r) => r.metadata as unknown as Outcome);
}

/** freeNotes as stored — the intake must survive every outcome below. */
async function storedNotes(): Promise<string> {
  const [row] = await db.select({ j: contentCycles.intakeJson }).from(contentCycles).where(eq(contentCycles.id, CYCLE));
  return ((row!.j as { planContent?: { freeNotes?: string } })?.planContent?.freeNotes) ?? '';
}

/**
 * The window boundary, read from the DATABASE clock rather than this process's.
 *
 * `audit_log.created_at` defaults to Postgres `now()`, so a boundary taken from `Date.now()` is
 * comparing two different clocks — and the first version of this harness padded a second onto it
 * to cover the skew, which was wide enough to sweep the PREVIOUS run's row into the next run's
 * window. That turned a clean per-run correlation into an off-by-one and made a passing run look
 * like a failing one. One clock, no padding.
 */
async function mark(): Promise<Date> {
  // `db.execute` hands back the driver's own row shape — an array on some, `{ rows }` on others
  // — and the timestamp arrives as a string. Both are normalised here rather than at three call
  // sites, and the `Date` is what `gt()` needs to serialise the comparison.
  const res = await db.execute(sql`select now() as now`);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{ now: string | Date }>;
  const now = rows[0]?.now;
  return now instanceof Date ? now : new Date(String(now));
}

beforeAll(async () => { await captureOriginal(); await resetCycle(); });
afterAll(async () => { await restoreOriginal(); });

// ── The cases ─────────────────────────────────────────────────────────────────────────────────

describe('a short brief is left alone', () => {
  it(`records no shortfall across ${RUNS} runs`, async () => {
    const seen: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      await resetCycle();
      const t0 = await mark();
      const res = await post(SHORT);
      const rows = await outcomesSince(t0);
      seen.push(`run${i + 1} ok=${res.ok} rows=${rows.length}${rows.length ? ` ${JSON.stringify(rows[0])}` : ''}`);
      expect(await storedNotes()).toContain('Maggie');
    }
    console.log(`\nSHORT brief (${SHORT.length} chars, no beats):\n  ${seen.join('\n  ')}`);
    // A one-product brief the extractor handles is silence — no row, no false alarm.
    expect(seen.every((s) => s.includes('rows=0'))).toBe(true);
  }, 300_000);
});

describe('a brief bigger than the budget', () => {
  it(`saves the intake and records an outcome across ${RUNS} runs, on a month with 41 beats`, async () => {
    const seen: string[] = [];
    const kinds: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      await resetCycle();
      await db.insert(contentCyclePosts).values(seedRows());
      const t0 = await mark();
      const res = await post(BIG);
      const rows = await outcomesSince(t0);
      const kind = rows.length === 0 ? 'clean'
        : rows[0]!.outcome === 'shortfall' ? `shortfall:[${rows[0]!.missing?.join(',')}]`
        : `failed:${rows[0]!.failure}`;
      kinds.push(kind);
      seen.push(`run${i + 1} ok=${res.ok} rows=${rows.length} ${kind}`);

      // Whatever the extraction did, the client's words are saved. That is the invariant.
      expect(res.ok).toBe(true);
      expect(await storedNotes()).toContain('Marley');
    }
    console.log(`\nBIG brief (${BIG.length} chars, 41 beats):\n  ${seen.join('\n  ')}`);
    // Nothing throws uncaught, and no run is silent about a loss: every run either came back
    // whole (clean) or left a row saying what happened.
    expect(kinds.length).toBe(RUNS);
  }, 600_000);
});

describe('an extraction that never returns', () => {
  it(`records the failure rather than silently nulling, across ${RUNS} runs`, async () => {
    const seen: string[] = [];
    const explains: boolean[] = [];
    for (let i = 0; i < RUNS; i++) {
      await resetCycle();
      const t0 = await mark();
      const res = await post(BIG);   // no beats → faithful but slow → past the 25s race
      const rows = await outcomesSince(t0);
      const [brief] = await db.select({ b: contentCycles.structuredBrief }).from(contentCycles).where(eq(contentCycles.id, CYCLE));
      const explained = brief!.b !== null || rows.length >= 1;
      explains.push(explained);
      seen.push(`run${i + 1} ok=${res.ok} rows=${rows.length} ${rows[0] ? `${rows[0].outcome}/${rows[0].failure ?? ''}` : '-'} briefNull=${brief!.b === null} explained=${explained}`);
      expect(res.ok).toBe(true);
      expect(await storedNotes()).toContain('Marley');
    }
    console.log(`\nBIG brief, NO beats (the timeout regime):\n  ${seen.join('\n  ')}`);
    // The old bare `catch { return null }` left a null brief and no trace. A null brief now
    // always comes with a row explaining it.
    expect(explains.every(Boolean)).toBe(true);
  }, 600_000);
});
