'use server';

import { db, contentCycles } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { IntakeJson } from '@sprigly/engine';
import { Queue } from 'bullmq';

export type IntakeActionResult = { ok: boolean; message?: string };

// ── BullMQ planning enqueue (mirrors apps/worker/src/content-cycles/job-options.ts) ──
const PLANNING_JOB_OPTIONS = { attempts: 3, backoff: { type: 'fixed' as const, delay: 15_000 } };
function planningJobId(cycleId: string): string { return `planning_${cycleId}`; }

/** Clear a stale entry under a deterministic jobId before re-enqueue.
 *  Identical to prepareJobSlot in ./actions.ts — without this, BullMQ silently
 *  dedups queue.add() against a completed/failed corpse and the job never runs.
 *  This is the same bug class already fixed for the request-email chain.
 *  - active   → a job is running; do NOT clear, do NOT re-add (caller skips).
 *  - completed/failed/unknown → remove so the dedup key is freed, then re-add.
 *  - waiting/delayed/etc.     → leave in place; re-add is a BullMQ no-op and the
 *                               pending job (same payload) will run on its own. */
async function prepareJobSlot(queue: Queue, jobId: string): Promise<{ ok: boolean; message?: string }> {
  const existing = await queue.getJob(jobId);
  if (!existing) return { ok: true };

  const state = await existing.getState();
  if (state === 'active') {
    return { ok: false, message: 'A planning job is already running for this cycle — wait for it to finish.' };
  }
  if (state === 'completed' || state === 'failed' || state === 'unknown') {
    try { await existing.remove(); } catch { /* best-effort; proceed either way */ }
  }
  return { ok: true };
}

/** Enqueue the planning job (intake_confirmed → planning). Non-fatal: a missing
 *  Redis URL or enqueue error is logged but does not fail the confirmation —
 *  the cycle is already intake_confirmed and the job can be re-triggered. */
async function enqueuePlanning(cycleId: string): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('[confirmIntake] REDIS_URL not set — planning job not enqueued');
    return;
  }
  const queue = new Queue('content-cycles', { connection: { url: redisUrl } });
  try {
    const jobId = planningJobId(cycleId);
    // Free any stale completed/failed entry under this jobId before re-enqueue.
    const slot = await prepareJobSlot(queue, jobId);
    if (!slot.ok) {
      console.warn(`[confirmIntake] planning job not enqueued — ${slot.message}`);
      return;
    }
    await queue.add(
      'planning',
      { type: 'planning', cycleId },
      { ...PLANNING_JOB_OPTIONS, jobId },
    );
  } finally {
    await queue.close();
  }
}

// Statuses from which a manual intake confirmation is allowed.
const INTAKE_CONFIRMABLE = new Set(['requested', 'reply_received', 'awaiting_confirmation']);

export async function saveIntake(formData: FormData): Promise<IntakeActionResult> {
  const cycleId  = formData.get('cycleId')  as string;
  const clientId = formData.get('clientId') as string;

  try {
    const answers: Record<string, string>   = JSON.parse((formData.get('answers')         as string) || '{}');
    const freeNotes                          = (formData.get('freeNotes')                  as string) ?? '';
    const businessContext: Array<{ note: string; capturedAt: string }> =
      JSON.parse((formData.get('businessContext') as string) || '[]');
    const otherChannelRaw = ((formData.get('otherChannel') as string) ?? '').trim();

    const intakeJson: IntakeJson = {
      planContent:     { answers, freeNotes },
      businessContext,
      otherChannel:    otherChannelRaw ? { general: [otherChannelRaw] } : {},
      source:          'manual',
      capturedAt:      new Date().toISOString(),
    };

    await db
      .update(contentCycles)
      .set({ intakeJson: intakeJson as unknown, updatedAt: new Date() })
      .where(eq(contentCycles.id, cycleId));

    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[saveIntake]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to save intake.' };
  }
}

export async function confirmIntake(formData: FormData): Promise<IntakeActionResult> {
  const cycleId  = formData.get('cycleId')  as string;
  const clientId = formData.get('clientId') as string;

  try {
    const rows = await db
      .select({ status: contentCycles.status, intakeJson: contentCycles.intakeJson })
      .from(contentCycles)
      .where(eq(contentCycles.id, cycleId))
      .limit(1);

    const cycle = rows[0];
    if (!cycle) return { ok: false, message: 'Cycle not found.' };

    // Idempotent: already confirmed
    if (cycle.status === 'intake_confirmed') return { ok: true };

    if (!INTAKE_CONFIRMABLE.has(cycle.status)) {
      return { ok: false, message: `Cannot confirm intake from status "${cycle.status}".` };
    }

    // Guard: must have at least one non-empty answer or free notes
    const intake = cycle.intakeJson as IntakeJson | null;
    const answers   = intake?.planContent?.answers ?? {};
    const freeNotes = (intake?.planContent?.freeNotes ?? '').trim();
    const hasContent = freeNotes.length > 0 ||
      Object.values(answers).some((v) => v.trim().length > 0);

    if (!hasContent) {
      return {
        ok:      false,
        message: 'Please fill in at least one answer or free notes before confirming intake.',
      };
    }

    await db
      .update(contentCycles)
      .set({ status: 'intake_confirmed', intakeSource: 'manual', updatedAt: new Date() })
      .where(eq(contentCycles.id, cycleId));

    // Kick off the planning phase. Only reached on the transition INTO
    // intake_confirmed (the idempotent guard above returns early if already
    // confirmed), so planning enqueues exactly once per confirmation.
    await enqueuePlanning(cycleId);

    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[confirmIntake]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to confirm intake.' };
  }
}
