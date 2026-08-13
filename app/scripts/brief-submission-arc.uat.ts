/**
 * brief-submission-arc.uat.ts — does the arc land where the client asked, repeatedly?
 *
 *   pnpm --filter @sprigly/app uat scripts/brief-submission-arc.uat.ts
 *
 * The change under test: the reshape is handed a brief extracted from the SUBMISSION rather
 * than from the ACCUMULATION. The accumulation is what abridges, and when it dropped the
 * product the sentence names, `briefArcDatesFor` answered `{}` and LAUNCH_ARC's [-5, 0, +3]
 * placed the month instead.
 *
 * ── THE DISCRIMINATOR ────────────────────────────────────────────────────────────────────────
 *
 * "On the 12th we're going to launch Maggie in yellow, can you write a teaser the week before",
 * plan month 2026-12:
 *   arc override fired  → tease on 2026-12-05  (the far edge of the week-before window,
 *                          entryDate/brief-schedule.ts, measured from the 12th)
 *   constant applied    → tease on 2026-12-07  (12 − 5)
 * One day apart in the data, a week apart in what the client asked for.
 *
 * ── THE FIXTURE ──────────────────────────────────────────────────────────────────────────────
 *
 * 32ca4deb (ivy-t, 2026-11, pre-planning, ZERO beats at baseline) — seeded and restored by this
 * file, exactly as brief-shortfall.uat.ts does. NOT 5ea00045, which is the reproduction the
 * investigation rests on. Beats are required: the reshape is gated on the month already having
 * a draft (intake/route.ts). The accumulated brief is pre-loaded with ivy-t's real command log
 * MINUS the Maggie sentence, so the accumulation is the shape that drops products and the
 * submission is the one sentence that does not — the exact split the change is about.
 *
 * Real Bedrock spend, real writes, sampled: the drop has run 5/5, 4/5 and 2/5 on identical
 * input across sessions, so this reports a distribution and one green run proves nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';

const CLIENT     = 'c79cf1c5-b51d-4a9b-aedc-48577df43e8f';
const CYCLE      = '32ca4deb-ac5b-4aaf-b7bf-aee7e01c463b';  // 2026-11 → plan month 2026-12
const PLAN_MONTH = '2026-12';
const RUNS       = 5;

const ARC_DATE      = `${PLAN_MONTH}-05`;   // the client's "week before"
const CONSTANT_DATE = `${PLAN_MONTH}-07`;   // LAUNCH_ARC's [-5]
const LAUNCH_DATE   = `${PLAN_MONTH}-12`;

const SUBMISSION = "On the 12th we're going to launch Maggie in yellow, can you write a teaser the week before";

/** ivy-t's real accumulated log, minus the Maggie line — the text that abridges. */
const PRIOR = [
  'Move the Maya post on the 5th to the 12th instead.',
  'Add a restock announcement post on the 5th of December.',
  'Big Connie relaunch on the 24th of December. Build up to it with posts on the 21st, 22nd and 23rd, all about Connie.',
  'Add a behind the scenes post on the 7th. Also the vibe should be more sdkjfh qwponx.',
  "On the 12th we're going to launch Hannah in green, can you write a teaser the week before and a follow up the week after as well as the launch post? Make them all reels.",
  'Add a giveaway post on the 18th. Not this month, but a Christmas gift guide would be good.',
  'Add a styling tips post on the 16th.',
  'Move the giveaway post on the 18th to the 17th.',
  'Add a customer story post on the 14th. Also qwx zzblorp the frimble on nonesuch.',
  'push Hannah in green launch out to the 18th',
  'move a post from the 17th to the 10th',
  "On the 12th we're going to launch X, can you write a teaser the week before",
  'launching Y on the 15th put a tease on the 2nd and follow up on the 23rd',
].join('\n\n');

vi.mock('@/lib/auth', () => ({ getSession: async () => ({ clientId: CLIENT, cycleId: CYCLE }) }));

const { POST } = await import('@/app/api/plan/intake/route');
const { db, contentCycles, contentCyclePosts } = await import('@sprigly/db');
const { and, eq, isNull } = await import('drizzle-orm');
const { resetRateLimit } = await import('@/lib/rate-limit');

let ORIGINAL: { intakeJson: unknown; structuredBrief: unknown } | null = null;

/** A month with beats, and a prior brief already accumulated on the cycle. */
function seedRows() {
  const titles = ['Sunday style', 'Behind the scenes', 'Customer story', 'Styling tips', 'Note from the founder'];
  return Array.from({ length: 20 }, (_, i) => ({
    cycleId: CYCLE, clientId: CLIENT, channel: 'instagram',
    scheduledDate: `${PLAN_MONTH}-${String((i % 28) + 1).padStart(2, '0')}`,
    format: 'single', pillar: 'brand', status: 'draft', position: i,
    sourceMeta: { title: `${titles[i % titles.length]} ${i + 1}` },
  }));
}

async function primeCycle(): Promise<void> {
  await db.delete(contentCyclePosts).where(eq(contentCyclePosts.cycleId, CYCLE));
  await db.insert(contentCyclePosts).values(seedRows());
  const [row] = await db.select({ j: contentCycles.intakeJson }).from(contentCycles).where(eq(contentCycles.id, CYCLE));
  const intake = (row!.j ?? {}) as Record<string, unknown>;
  const pc = (intake.planContent ?? {}) as Record<string, unknown>;
  await db.update(contentCycles).set({
    intakeJson: { ...intake, planContent: { ...pc, answers: {}, freeNotes: PRIOR } },
    structuredBrief: null,
  }).where(eq(contentCycles.id, CYCLE));
}

async function restoreOriginal(): Promise<void> {
  await db.delete(contentCyclePosts).where(eq(contentCyclePosts.cycleId, CYCLE));
  if (!ORIGINAL) return;
  await db.update(contentCycles)
    .set({ intakeJson: ORIGINAL.intakeJson, structuredBrief: ORIGINAL.structuredBrief })
    .where(eq(contentCycles.id, CYCLE));
}

/** Every Maggie post on the month, by date — the arc as actually placed. */
async function maggieDates(): Promise<string[]> {
  const rows = await db.select({ date: contentCyclePosts.scheduledDate, meta: contentCyclePosts.sourceMeta })
    .from(contentCyclePosts).where(and(
      eq(contentCyclePosts.cycleId, CYCLE), eq(contentCyclePosts.status, 'draft'), isNull(contentCyclePosts.deletedAt)));
  return rows
    .filter((r) => /Maggie/i.test(String((r.meta as Record<string, unknown> | null)?.['title'] ?? '')))
    .map((r) => r.date).sort();
}

beforeAll(async () => {
  const [row] = await db.select({ j: contentCycles.intakeJson, b: contentCycles.structuredBrief })
    .from(contentCycles).where(eq(contentCycles.id, CYCLE));
  ORIGINAL = { intakeJson: row!.j, structuredBrief: row!.b };
});
afterAll(async () => { await restoreOriginal(); });

describe('the arc lands where the client asked', () => {
  it(`places the tease on the ${ARC_DATE.slice(-2)}th, not the ${CONSTANT_DATE.slice(-2)}th, across ${RUNS} runs`, async () => {
    const seen: string[] = [];
    const verdicts: string[] = [];
    for (let i = 1; i <= RUNS; i++) {
      await primeCycle();
      resetRateLimit();
      const res = await POST(new Request('http://uat/api/plan/intake', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cycleId: CYCLE, freeNotes: SUBMISSION, source: 'web' }),
      }));
      const dates = await maggieDates();
      const verdict = dates.includes(ARC_DATE) ? 'ARC'
        : dates.includes(CONSTANT_DATE) ? 'CONSTANT'
        : dates.length === 0 ? 'no-maggie-placed' : 'other';
      verdicts.push(verdict);
      seen.push(`run${i} ok=${res.ok} maggie=[${dates.join(', ')}] → ${verdict}`);
    }
    console.log(`\nsubmission="${SUBMISSION}"\nprior brief = ${PRIOR.length} chars (the shape that abridges)\n  ${seen.join('\n  ')}`);
    console.log(`  DISTRIBUTION arc=${verdicts.filter((v) => v === 'ARC').length}/${RUNS} `
      + `constant=${verdicts.filter((v) => v === 'CONSTANT').length}/${RUNS} `
      + `none=${verdicts.filter((v) => v === 'no-maggie-placed').length}/${RUNS} `
      + `other=${verdicts.filter((v) => v === 'other').length}/${RUNS}`);

    // The launch itself is the floor: whatever else happens, the 12th is what the client said.
    expect(verdicts.filter((v) => v === 'CONSTANT')).toHaveLength(0);
  }, 900_000);
});
