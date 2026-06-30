'use server';

import { randomBytes } from 'node:crypto';
import { db, promptTemplates, clientConfigs, workflowRuns, clientChannels, clients, contentCycles, appMagicLinkTokens } from '@sprigly/db';
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { ingestSource } from '@sprigly/knowledge';
import { Queue } from 'bullmq';
import type { IntakeJson } from '@sprigly/engine';
import { enqueuePlanning } from './planning-enqueue';

// ── BullMQ job helpers (mirrored from apps/worker/src/content-cycles/job-options.ts) ──
const IG_TRAWL_JOB_OPTIONS    = { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } } as const;
const REQUEST_EMAIL_JOB_OPTIONS = { attempts: 3, backoff: { type: 'fixed',       delay: 15_000 } } as const;
function igTrawlJobId(clientId: string, channel: string, dataMonth: string)    { return `ig-trawl_${clientId}_${channel}_${dataMonth}`; }
function requestEmailJobId(clientId: string, channel: string, dataMonth: string) { return `request-email_${clientId}_${channel}_${dataMonth}`; }

// Statuses where a cycle is considered "already underway" — mirrors scheduler.ts ACTIVE_STATUSES.
// 'scheduled' and 'failed' are intentionally absent: re-enqueue is safe for those.
const ACTIVE_STATUSES: ReadonlyArray<string> = [
  'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed',
  'planning', 'workbook_built', 'delivered', 'active', 'finalised',
  'awaiting_voice_approval', 'voice_merged', 'closed',
];

function getCyclesQueue(): Queue {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('[content-cycles] REDIS_URL not set');
  return new Queue('content-cycles', { connection: { url: redisUrl } });
}

// ── Copy client link ──────────────────────────────────────────────────────────
// Mint a revocable magic link to the client app (app.sprigly.co.uk) for THIS
// cycle. Inserts an app_magic_link_tokens row directly (admin can't import app/'s
// signLink, but it's the same table). 30-day expiry; revocable via revoked_at.
export async function copyClientLink(formData: FormData): Promise<{ ok: boolean; url?: string; message?: string }> {
  const clientId  = String(formData.get('clientId')  ?? '');
  const channel   = String(formData.get('channel')   ?? '');
  const dataMonth = String(formData.get('dataMonth') ?? '');
  if (!clientId || !channel || !dataMonth) return { ok: false, message: 'Missing cycle context.' };

  const [cycle] = await db
    .select({ id: contentCycles.id })
    .from(contentCycles)
    .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, dataMonth)))
    .limit(1);
  if (!cycle) return { ok: false, message: 'No cycle for this month yet — run the cycle first.' };

  const token = randomBytes(32).toString('base64url');
  await db.insert(appMagicLinkTokens).values({
    clientId, cycleId: cycle.id, token,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  });
  const base = (process.env.APP_BASE_URL ?? 'https://app.sprigly.co.uk').replace(/\/$/, '');
  return { ok: true, url: `${base}/p/${token}` };
}

// Check the existing job's state before touching it.
// - active   → job is locked by a worker; cannot remove, must wait.
// - completed/failed/unknown → remove so the dedup key is freed, then caller re-adds.
// - waiting/delayed/prioritized/waiting-children → job is already pending; re-adding
//   with the same jobId is a BullMQ no-op, so skip the remove and let the add proceed.
async function prepareJobSlot(
  queue: Queue,
  jobId: string,
): Promise<{ ok: boolean; message?: string }> {
  const existing = await queue.getJob(jobId);
  if (!existing) return { ok: true };

  const state = await existing.getState();

  if (state === 'active') {
    return {
      ok: false,
      message: 'A job is already running for this month — wait for it to finish before re-triggering.',
    };
  }

  if (state === 'completed' || state === 'failed' || state === 'unknown') {
    try { await existing.remove(); } catch { /* best-effort; proceed either way */ }
  }
  // waiting/delayed/prioritized/waiting-children: leave in place; BullMQ dedup handles it.
  return { ok: true };
}

export type ActionResult = { ok: boolean; message?: string };

export async function triggerCycle(formData: FormData): Promise<ActionResult> {
  const clientId  = formData.get('clientId')  as string;
  const channel   = formData.get('channel')   as string;
  const dataMonth = formData.get('dataMonth') as string;

  const queue = getCyclesQueue();
  try {
    const trawlJobId = igTrawlJobId(clientId, channel, dataMonth);
    const emailJobId = requestEmailJobId(clientId, channel, dataMonth);

    // Check ig-trawl slot — if active/locked, surface that and stop.
    const trawlSlot = await prepareJobSlot(queue, trawlJobId);
    if (!trawlSlot.ok) return trawlSlot;

    // Free any completed/failed request-email entry so the chain from ig-trawl
    // can land. BullMQ deduplicates queue.add() silently against completed jobs —
    // if we don't clear this, the chain is a no-op and no draft is ever created.
    // (If request-email is active, prepareJobSlot returns ok:false which we
    // intentionally ignore here — the email is already running, which is fine.)
    await prepareJobSlot(queue, emailJobId);

    // Seed / reset cycle row only after confirming we can enqueue.
    await db.update(contentCycles)
      .set({ status: 'scheduled', requestSentAt: null })
      .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, dataMonth)));
    await db.insert(contentCycles)
      .values({ clientId, channel, cycleMonth: dataMonth, status: 'scheduled' })
      .onConflictDoNothing();

    await queue.add('ig-trawl', { type: 'ig-trawl', clientId, channel, dataMonth }, { ...IG_TRAWL_JOB_OPTIONS, jobId: trawlJobId });
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[triggerCycle]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to enqueue cycle.' };
  } finally {
    await queue.close();
  }
}

export async function triggerTrawl(formData: FormData): Promise<ActionResult> {
  const clientId  = formData.get('clientId')  as string;
  const channel   = formData.get('channel')   as string;
  const dataMonth = formData.get('dataMonth') as string;

  const queue = getCyclesQueue();
  try {
    const trawlJobId = igTrawlJobId(clientId, channel, dataMonth);
    const emailJobId = requestEmailJobId(clientId, channel, dataMonth);

    const trawlSlot = await prepareJobSlot(queue, trawlJobId);
    if (!trawlSlot.ok) return trawlSlot;

    // Same as triggerCycle: free completed request-email entry so chain lands.
    await prepareJobSlot(queue, emailJobId);

    await queue.add('ig-trawl', { type: 'ig-trawl', clientId, channel, dataMonth }, { ...IG_TRAWL_JOB_OPTIONS, jobId: trawlJobId });
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[triggerTrawl]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to enqueue trawl.' };
  } finally {
    await queue.close();
  }
}

export async function triggerEmail(formData: FormData): Promise<ActionResult> {
  const clientId  = formData.get('clientId')  as string;
  const channel   = formData.get('channel')   as string;
  const dataMonth = formData.get('dataMonth') as string;

  const queue = getCyclesQueue();
  try {
    const jobId = requestEmailJobId(clientId, channel, dataMonth);
    const slotResult = await prepareJobSlot(queue, jobId);
    if (!slotResult.ok) return slotResult;

    await queue.add('request-email', { type: 'request-email', clientId, channel, dataMonth }, { ...REQUEST_EMAIL_JOB_OPTIONS, jobId });
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[triggerEmail]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to enqueue email.' };
  } finally {
    await queue.close();
  }
}

/**
 * "Run planning now" — fire the planning job directly for this month's cycle,
 * skipping the reset→run→confirm-intake dance. Generates NEXT month's plan (the
 * worker targets cycle_month + 1) → validation loop → CSV → build-workbook → xlsx
 * → delivery to the (pinned) test inbox. Re-runnable: re-pressing on a
 * workbook_built cycle re-enters planning cleanly.
 *
 * Precondition: planContent must be present (planning reads the intake answers).
 * Reuses the shared enqueuePlanning path; cycle state is normalised to
 * intake_confirmed only once the job slot is confirmed free.
 */
export async function triggerPlanning(formData: FormData): Promise<ActionResult> {
  const clientId  = formData.get('clientId')  as string;
  const channel   = formData.get('channel')   as string;
  const dataMonth = formData.get('dataMonth') as string;

  try {
    const rows = await db
      .select({ id: contentCycles.id, status: contentCycles.status, intakeJson: contentCycles.intakeJson })
      .from(contentCycles)
      .where(and(
        eq(contentCycles.clientId,   clientId),
        eq(contentCycles.channel,    channel),
        eq(contentCycles.cycleMonth, dataMonth),
      ))
      .limit(1);

    const cycle = rows[0];
    if (!cycle) return { ok: false, message: `No cycle for ${dataMonth} yet — run the cycle or enter intake first.` };

    // Intake precondition: planning needs this month's planContent answers.
    const intake    = cycle.intakeJson as IntakeJson | null;
    const answers   = intake?.planContent?.answers ?? {};
    const freeNotes = (intake?.planContent?.freeNotes ?? '').trim();
    const hasIntake = freeNotes.length > 0 || Object.values(answers).some((v) => v.trim().length > 0);
    if (!hasIntake) {
      return { ok: false, message: 'Enter intake first — planning needs this month\'s answers.' };
    }

    // Normalise to intake_confirmed (the worker's planning entry state) ONLY once
    // the slot is free — handles first-run-from-unconfirmed AND re-fire from
    // workbook_built, reusing the existing intake_confirmed → planning transition.
    const result = await enqueuePlanning(cycle.id, async () => {
      if (cycle.status !== 'intake_confirmed') {
        await db.update(contentCycles)
          .set({ status: 'intake_confirmed', intakeSource: 'manual', updatedAt: new Date() })
          .where(eq(contentCycles.id, cycle.id));
      }
    });
    if (!result.ok) return result;

    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[triggerPlanning]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to enqueue planning.' };
  }
}

export async function resetCycle(formData: FormData): Promise<void> {
  const clientId  = formData.get('clientId')  as string;
  const channel   = formData.get('channel')   as string;
  const dataMonth = formData.get('dataMonth') as string;

  await db.update(contentCycles)
    .set({ status: 'scheduled', requestSentAt: null })
    .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, dataMonth)));

  revalidatePath(`/admin/clients/${clientId}`);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateContentCycleSettings(formData: FormData): Promise<void> {
  const clientId = formData.get('clientId') as string;
  const channel  = formData.get('channel')  as string;

  const instagramHandle = (formData.get('instagramHandle') as string).trim() || null;
  const contactName     = (formData.get('contactName')     as string).trim() || null;
  const contactEmail    = (formData.get('contactEmail')    as string).trim() || null;

  if (contactEmail && !EMAIL_RE.test(contactEmail)) {
    throw new Error(`Invalid email address: "${contactEmail}"`);
  }

  const dayRaw  = (formData.get('scheduleDay')  as string).trim();
  const hourRaw = (formData.get('scheduleHour') as string).trim();
  let contentCycleSchedule: { day: number; hour: number } | null = null;
  if (dayRaw && hourRaw) {
    const day  = parseInt(dayRaw,  10);
    const hour = parseInt(hourRaw, 10);
    if (isNaN(day)  || day  < 1  || day  > 28) throw new Error(`Schedule day must be 1–28, got "${dayRaw}"`);
    if (isNaN(hour) || hour < 0  || hour > 23) throw new Error(`Schedule hour must be 0–23, got "${hourRaw}"`);
    contentCycleSchedule = { day, hour };
  }

  const extraQuestionsRaw = (formData.get('extraQuestions') as string) ?? '';
  const extraQuestions = extraQuestionsRaw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  await db
    .update(clientChannels)
    .set({
      instagramHandle,
      contactEmail,
      contactName,
      contentCycleSchedule,
      extraQuestions: extraQuestions.length > 0 ? extraQuestions : null,
    })
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)));

  revalidatePath(`/admin/clients/${clientId}`);
}

export async function updateContentCycleEnabled(formData: FormData): Promise<void> {
  const clientId = formData.get('clientId') as string;
  const enabled  = formData.get('enabled') === 'true';

  await db
    .update(clients)
    .set({ contentCycleEnabled: enabled })
    .where(eq(clients.id, clientId));

  revalidatePath(`/admin/clients/${clientId}`);
}

export async function updateStepModel(formData: FormData): Promise<void> {
  const clientId = formData.get('clientId') as string;
  const workflowId = formData.get('workflowId') as string;
  const stepName = formData.get('stepName') as string;
  const model = formData.get('model') as string;

  const rows = await db
    .select({ settings: clientConfigs.settings })
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, clientId))
    .limit(1);

  const current = rows[0]?.settings ?? {};
  const stepModels = (current['stepModels'] ?? {}) as Record<string, Record<string, string>>;
  stepModels[workflowId] = { ...(stepModels[workflowId] ?? {}), [stepName]: model };

  await db
    .update(clientConfigs)
    .set({ settings: { ...current, stepModels } })
    .where(eq(clientConfigs.clientId, clientId));

  revalidatePath(`/admin/clients/${clientId}`);
}

export async function approveQaDraft(formData: FormData): Promise<void> {
  const runId    = formData.get('runId') as string;
  const finalText = formData.get('finalText') as string;

  if (!runId || !finalText.trim()) return;

  const rows = await db
    .select({ clientId: workflowRuns.clientId, output: workflowRuns.output })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .limit(1);

  const run = rows[0];
  if (run === undefined) return;

  const output = run.output as { feedbackIngestedAt?: string; draftText?: string } | null;

  // Idempotency guard — whichever path (send-detection or admin) fires first wins.
  if (output?.feedbackIngestedAt !== undefined) return;

  if (typeof output?.draftText === 'string' && output.draftText !== finalText) {
    console.log(
      `[qa-feedback] admin approve run=${runId} ` +
      `original=${output.draftText.length}chars final=${finalText.length}chars`,
    );
  }

  const model          = createModelClientFromEnv();
  const embeddingClient = createEmbeddingClientFromEnv();

  await ingestSource(
    run.clientId,
    { sourceType: 'approved_draft', text: finalText, ref: runId },
    { db, model, embeddingClient, labelModel: 'haiku' },
  );

  await db
    .update(workflowRuns)
    .set({
      output: sql`COALESCE(${workflowRuns.output}, '{}'::jsonb) || ${JSON.stringify({ feedbackIngestedAt: new Date().toISOString() })}::jsonb`,
    })
    .where(eq(workflowRuns.id, runId));

  revalidatePath(`/admin/clients/${run.clientId}`);
}

export async function customisePrompt(formData: FormData): Promise<void> {
  const clientId = formData.get('clientId') as string;
  const workflowId = formData.get('workflowId') as string;
  const stepName = formData.get('stepName') as string;

  // Find the shared default to copy text from
  const sharedRows = await db
    .select({ id: promptTemplates.id, version: promptTemplates.version, promptText: promptTemplates.promptText })
    .from(promptTemplates)
    .where(
      and(
        isNull(promptTemplates.clientId),
        eq(promptTemplates.workflowId, workflowId),
        eq(promptTemplates.stepName, stepName),
      ),
    )
    .orderBy(desc(promptTemplates.version))
    .limit(1);

  const sharedDefault = sharedRows[0];
  const promptText = sharedDefault?.promptText ?? '';

  // Check no client-specific row already exists
  const existingRows = await db
    .select({ id: promptTemplates.id })
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.clientId, clientId),
        eq(promptTemplates.workflowId, workflowId),
        eq(promptTemplates.stepName, stepName),
      ),
    )
    .limit(1);

  if (existingRows[0] !== undefined) {
    redirect(`/admin/prompts/${existingRows[0].id}`);
  }

  const [newRow] = await db
    .insert(promptTemplates)
    .values({
      clientId,
      workflowId,
      stepName,
      promptText,
      version: 1,
      copiedFromTemplateId: sharedDefault?.id ?? null,
      copiedFromVersion: sharedDefault?.version ?? null,
    })
    .returning({ id: promptTemplates.id });

  revalidatePath(`/admin/clients/${clientId}`);

  if (newRow) {
    redirect(`/admin/prompts/${newRow.id}`);
  }
}
