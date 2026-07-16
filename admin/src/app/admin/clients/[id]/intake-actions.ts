'use server';

import { db, contentCycles, clearStructuredBriefIfPrePlanning } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { IntakeJson } from '@sprigly/engine';
import { hasPlannableInput } from '@sprigly/engine';
import { enqueuePlanning } from './planning-enqueue';

export type IntakeActionResult = { ok: boolean; message?: string };

// Statuses from which a manual intake confirmation is allowed. 'scheduled' is included because
// cutoffDay clients no longer pass through 'requested' (the legacy request email is gated off for
// them) — they sit at the seed state with intake open and must still be confirmable.
const INTAKE_CONFIRMABLE = new Set(['scheduled', 'requested', 'reply_received', 'awaiting_confirmation']);

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

    // Intake changed → the extract-once structured_brief is now stale. Clear it so the next
    // planning run re-extracts (no-op at/after planning; the shared @sprigly/db helper is the
    // same one Build 3's app intake route will call).
    await clearStructuredBriefIfPrePlanning(db, cycleId);

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
      .select({ status: contentCycles.status, intakeJson: contentCycles.intakeJson, clientId: contentCycles.clientId, cycleMonth: contentCycles.cycleMonth })
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

    // Guard: QUESTION B (hasPlannableInput) — this month's answers/free notes OR a durable note
    // relevant to the plan month. Durable now counts, matching what the generator consumes.
    const plannable = await hasPlannableInput(db, { clientId: cycle.clientId, cycleMonth: cycle.cycleMonth, intakeJson: cycle.intakeJson });
    if (!plannable) {
      return {
        ok:      false,
        message: 'Add at least one answer, a free note, or a relevant durable note before confirming intake.',
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
