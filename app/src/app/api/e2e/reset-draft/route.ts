/**
 * POST /api/e2e/reset-draft — put the seeded draft month back.
 *
 * TEST-ONLY: 404 unless the e2e fake gate is on (SPRIGLY_E2E_FAKE=1 AND NODE_ENV !==
 * 'production'), the same gate `/api/e2e/activity` uses, so it cannot exist in a real deploy.
 *
 * ── Why it exists ────────────────────────────────────────────────────────────────────
 *
 * Approving a draft is destructive by design: every beat leaves 'draft' and the cycle becomes a
 * committed month. Two Playwright projects need to exercise that, Playwright runs them against
 * one container in one pass, and there is no reseed between them. Without this, the desktop
 * project's Generate test would delete the mobile project's fixture.
 *
 * ── Why it REBUILDS rather than patches ──────────────────────────────────────────────
 *
 * The obvious implementation flips the statuses back and clears `approved_at`. It is also
 * wrong: that is a second description of what approval changes, written by hand, and it goes
 * stale the first time approval touches a field nobody thought to add here — leaving a "restored"
 * month carrying a caption the fan-out wrote, or a hook, and a suite that passes while testing
 * something other than a draft.
 *
 * So it deletes the month and rebuilds it from `draftBeatRows()` — the SAME function the seed
 * calls. There is one definition of what this month is. A field approval starts touching
 * tomorrow is wiped by the delete without anyone editing this file.
 */
import { NextResponse } from 'next/server';
import { and, eq, notInArray } from 'drizzle-orm';
import {
  db, contentCycles, contentCyclePosts, planInputs,
  draftBeatRows, draftBacklogInput, DRAFT_CYCLE, SEED_PLAN_INPUT_IDS,
} from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { e2eFakeEnabled } from '@/lib/e2e-fake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!e2eFakeEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  // Scoped to the seeded draft cycle AND the session's client. A test session cannot use this
  // to rebuild a month it does not own, and it cannot point it at a different cycle at all —
  // there is no parameter to point.
  if (session.cycleId !== DRAFT_CYCLE) {
    return NextResponse.json({ error: 'not_the_draft_cycle' }, { status: 409 });
  }
  const clientId = session.clientId;

  await db.transaction(async (tx) => {
    // `plan_activity` is deliberately NOT touched. It is append-only — a row trigger blocks
    // both UPDATE and DELETE — and migration 0090 argues the point: an audit ledger outliving
    // its subjects is normal, and "referential integrity is the wrong contract for a history
    // table". The posts can go without it; the record that they once moved should not.
    // (This was written the other way round first, and Postgres refused: "plan_activity is
    // append-only (DELETE is blocked)". The database was right.)
    await tx.delete(contentCyclePosts).where(and(
      eq(contentCyclePosts.clientId, clientId), eq(contentCyclePosts.cycleId, DRAFT_CYCLE)));

    // EVERY input the seed did not make. A reshape the applier cannot place files the sentence
    // to the backlog — correctly, and the spec types two of those on purpose — with
    // `cycle_id: null`, because durable items are cycle-independent. So there is no cycle to
    // scope a delete by, and without the known-id list each run left two more ideas behind:
    // the Ideas rail climbed run over run, and the committed suite's Ideas assertions were
    // quietly depending on how often anyone had run this one.
    await tx.delete(planInputs).where(and(
      eq(planInputs.clientId, clientId),
      notInArray(planInputs.id, [...SEED_PLAN_INPUT_IDS]),
    ));
    await tx.delete(planInputs).where(and(
      eq(planInputs.clientId, clientId), eq(planInputs.usedInCycleId, DRAFT_CYCLE)));

    await tx.insert(planInputs).values(draftBacklogInput(clientId, DRAFT_CYCLE));
    await tx.insert(contentCyclePosts).values(draftBeatRows(clientId, DRAFT_CYCLE));

    // `approvedAt` is what closes the door: `cycleIsPreCutoff` returns false once it is set,
    // and `approveDraftCore` refuses with `already_approved`. Clearing it is not a detail —
    // it is the difference between a restored draft and a month that merely looks like one.
    //
    // `intakeJson` goes with it, because that is where the RECEIPTS live
    // (`intake_json.draftApplications`, loadReceipts) — and a receipt is a record of a reshape,
    // so a month restored with last test's receipt still on it is not the seeded month. The
    // screenshot is what caught this: a "Saved to your ideas" chip sitting over a fresh draft.
    await tx.update(contentCycles)
      .set({ approvedAt: null, approvedBy: null, status: 'intake_confirmed', intakeJson: {} })
      .where(eq(contentCycles.id, DRAFT_CYCLE));
  });

  return NextResponse.json({ ok: true, beats: draftBeatRows().length });
}
