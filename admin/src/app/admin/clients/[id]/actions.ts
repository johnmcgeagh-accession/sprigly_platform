'use server';

import { randomBytes } from 'node:crypto';
import { db, promptTemplates, clientConfigs, workflowRuns, clientChannels, clients, contentCycles, contentCyclePosts, appMagicLinkTokens } from '@sprigly/db';
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { ingestSource } from '@sprigly/knowledge';
import { Queue } from 'bullmq';
import type { IntakeJson } from '@sprigly/engine';
import { enqueuePlanning } from './planning-enqueue';
import { enqueueWeeklySession, londonWeekStart } from './weekly-session-enqueue';

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
export async function copyClientLink(formData: FormData): Promise<{ ok: boolean; url?: string; message?: string; needsConfirm?: boolean }> {
  const clientId  = String(formData.get('clientId')  ?? '');
  const channel   = String(formData.get('channel')   ?? '');
  const dataMonth = String(formData.get('dataMonth') ?? '');
  const confirmEmpty = String(formData.get('confirmEmpty') ?? '') === 'true';
  if (!clientId || !channel || !dataMonth) return { ok: false, message: 'Missing cycle context.' };

  const [cycle] = await db
    .select({ id: contentCycles.id })
    .from(contentCycles)
    .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, dataMonth)))
    .limit(1);
  if (!cycle) return { ok: false, message: 'No cycle for this month yet — run the cycle first.' };

  // Empty-cycle guard: a link to a cycle with no live posts lands the client on an
  // empty plan (and, being the newest token, becomes their home cycle). Require an
  // explicit confirmation before minting one, so it's never done by accident.
  const liveRows = await db
    .select({ liveCount: sql<number>`count(*)::int` })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycle.id), isNull(contentCyclePosts.deletedAt)));
  const liveCount = liveRows[0]?.liveCount ?? 0;
  if (liveCount === 0 && !confirmEmpty) {
    return { ok: false, needsConfirm: true, message: 'This cycle has no posts yet — the client would land on an empty plan. Copy the link anyway?' };
  }

  const token = randomBytes(32).toString('base64url');
  await db.insert(appMagicLinkTokens).values({
    clientId, cycleId: cycle.id, token,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  });
  // /p/<token> is a CLIENT app route. Admin has no env schema, so guard here: if
  // APP_BASE_URL is unset OR wrongly points at the admin origin, fall back to the
  // app origin rather than mint a dead admin.sprigly.co.uk/p/… link.
  const raw = (process.env.APP_BASE_URL ?? 'https://app.sprigly.co.uk').replace(/\/$/, '');
  let base = raw;
  try { if (/^admin\./i.test(new URL(raw).hostname)) base = 'https://app.sprigly.co.uk'; }
  catch { base = 'https://app.sprigly.co.uk'; }
  return { ok: true, url: `${base}/p/${token}` };
}

// ── Delivery surface preference ───────────────────────────────────────────────
// Per-channel control for what the cycle delivery email links to: 'app' (app link
// only), 'sheet' (workbook only), 'both' (default). Stored on client_channels.
export async function setDeliverySurface(formData: FormData): Promise<ActionResult> {
  const clientId = String(formData.get('clientId') ?? '');
  const channel  = String(formData.get('channel')  ?? '');
  const surface  = String(formData.get('surface')  ?? '');
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };
  if (surface !== 'app' && surface !== 'sheet' && surface !== 'both') return { ok: false, message: 'Invalid surface.' };

  await db.update(clientChannels)
    .set({ deliverySurface: surface })
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)));
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

// ── AI-change limit (Phase 4) ─────────────────────────────────────────────────
// Monthly allowance of AI changes (rewrites/regen) per channel. Structural edits
// are always free. A future override_until lifts the cap ("Lift limit for 30 days").

export async function setAiChangeLimit(formData: FormData): Promise<ActionResult> {
  const clientId = String(formData.get('clientId') ?? '');
  const channel  = String(formData.get('channel')  ?? '');
  const raw      = String(formData.get('limit')    ?? '').trim();
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };
  const limit = parseInt(raw, 10);
  if (isNaN(limit) || limit < 0 || limit > 100000) return { ok: false, message: `Invalid limit "${raw}".` };

  await db.update(clientChannels)
    .set({ aiChangeLimit: limit })
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)));
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Lift the limit for 30 days (override_until = now + 30 days) — unblocks a client
 *  while real usage is watched via the app counter. */
export async function liftAiLimit(formData: FormData): Promise<ActionResult> {
  const clientId = String(formData.get('clientId') ?? '');
  const channel  = String(formData.get('channel')  ?? '');
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };

  const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.update(clientChannels)
    .set({ aiChangeLimitOverrideUntil: until })
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)));
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

export async function clearAiLimitOverride(formData: FormData): Promise<ActionResult> {
  const clientId = String(formData.get('clientId') ?? '');
  const channel  = String(formData.get('channel')  ?? '');
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };

  await db.update(clientChannels)
    .set({ aiChangeLimitOverrideUntil: null })
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)));
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

// ── Posts-per-week (Phase 4) ──────────────────────────────────────────────────
// Blank = derive from config/history (unchanged). A value targets that cadence.
export async function setPostsPerWeek(formData: FormData): Promise<ActionResult> {
  const clientId = String(formData.get('clientId') ?? '');
  const channel  = String(formData.get('channel')  ?? '');
  const raw      = String(formData.get('postsPerWeek') ?? '').trim();
  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };

  let postsPerWeek: number | null = null;
  if (raw !== '') {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1 || n > 14) return { ok: false, message: `Posts per week must be 1–14 (or blank for auto), got "${raw}".` };
    postsPerWeek = n;
  }

  await db.update(clientChannels)
    .set({ postsPerWeek })
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)));
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
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
/**
 * Run the weekly planning session now for this cycle and the upcoming week.
 * Enqueues a 'weekly-session' job; the engine worker audits the week (weather +
 * maturing notes + date conflicts) and writes reviewable proposals into the
 * client app. Re-runnable — deterministic jobId per cycle+week dedups in-flight.
 */
export async function triggerWeeklySession(formData: FormData): Promise<ActionResult> {
  const clientId  = formData.get('clientId')  as string;
  const channel   = formData.get('channel')   as string;
  const dataMonth = formData.get('dataMonth') as string;

  try {
    const rows = await db
      .select({ id: contentCycles.id })
      .from(contentCycles)
      .where(and(
        eq(contentCycles.clientId,   clientId),
        eq(contentCycles.channel,    channel),
        eq(contentCycles.cycleMonth, dataMonth),
      ))
      .limit(1);

    const cycle = rows[0];
    if (!cycle) return { ok: false, message: `No cycle for ${dataMonth} yet — run the cycle first.` };

    const result = await enqueueWeeklySession(clientId, cycle.id, londonWeekStart());
    if (!result.ok) return result;

    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[triggerWeeklySession]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to enqueue the weekly session.' };
  }
}

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

/** "YYYY-MM" → the previous month's "YYYY-MM" (rolls the year at January).
 *  Inverse of the worker's nextMonth(): the data month behind a plan month. */
function prevMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1)); // m is 1-based; m-2 == previous month index
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * "Start & prepare" — create/reuse the cycle for an ARBITRARY plan month and run
 * the same automated INPUT-FETCH trace the scheduler does (ig-trawl → request-email),
 * then STOP. It deliberately does NOT plan: planning stays a separate, deliberate
 * click so John can first see which inputs were actually found (IG posts + sales in
 * Drive) and fill any gaps before generating — no auto-planning on thin data, which
 * is what produced July off missing IG/sales.
 *
 * `planMonth` is the month you want posts for. The worker plans cycle_month + 1, so
 * the cycle is keyed at cycle_month = planMonth − 1 (the data month), and ig-trawl /
 * sales fetch for that data month. The cycle lands at 'requested' (request-email's
 * transition); it never reaches delivery, so the John-pinned delivery is untouched.
 * Reuses the same job helpers/jobIds as the scheduler — no duplicated fetch logic.
 */
export async function startCycleForMonth(formData: FormData): Promise<ActionResult> {
  const clientId  = formData.get('clientId')  as string;
  const channel   = formData.get('channel')   as string;
  const planMonth = String(formData.get('planMonth') ?? '').trim();

  if (!clientId || !channel) return { ok: false, message: 'Missing client/channel.' };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(planMonth)) {
    return { ok: false, message: `Invalid month "${planMonth}" — expected YYYY-MM.` };
  }

  // The worker plans cycle_month + 1, so the data month behind a July plan is June.
  const dataMonth = prevMonth(planMonth);

  const queue = getCyclesQueue();
  try {
    const trawlJobId = igTrawlJobId(clientId, channel, dataMonth);
    const emailJobId = requestEmailJobId(clientId, channel, dataMonth);

    // Don't double-fire if a trawl is already running for this month.
    const trawlSlot = await prepareJobSlot(queue, trawlJobId);
    if (!trawlSlot.ok) return trawlSlot;
    // Free any completed request-email entry so the ig-trawl→request-email chain lands.
    await prepareJobSlot(queue, emailJobId);

    // Create the cycle if this (client, channel, month) has never run; otherwise reset
    // it to 'scheduled' so the fetch trace re-runs cleanly. We do NOT set
    // intake_confirmed and do NOT enqueue planning — prepare stops at 'requested'.
    // (This only resets cycle STATUS; content_cycle_posts are untouched — those are
    // only ever rewritten by the planning worker, so no other month's plan is at risk.)
    await db.update(contentCycles)
      .set({ status: 'scheduled', requestSentAt: null })
      .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, dataMonth)));
    await db.insert(contentCycles)
      .values({ clientId, channel, cycleMonth: dataMonth, status: 'scheduled' })
      .onConflictDoNothing();

    await queue.add('ig-trawl', { type: 'ig-trawl', clientId, channel, dataMonth }, { ...IG_TRAWL_JOB_OPTIONS, jobId: trawlJobId });
    revalidatePath(`/admin/clients/${clientId}`);
    return {
      ok: true,
      message: `Preparing ${planMonth} (data month ${dataMonth}) — running IG trawl → request-email. Stops before planning; check the inputs found below, then run planning.`,
    };
  } catch (err) {
    console.error('[startCycleForMonth]', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Failed to start & prepare.' };
  } finally {
    await queue.close();
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

  const dayRaw      = (formData.get('scheduleDay')      as string).trim();
  const hourRaw     = (formData.get('scheduleHour')     as string).trim();
  const cutoffRaw   = ((formData.get('scheduleCutoffDay') as string) ?? '').trim();
  let contentCycleSchedule: { day: number; hour: number; cutoffDay?: number | null } | null = null;
  if (dayRaw && hourRaw) {
    const day  = parseInt(dayRaw,  10);
    const hour = parseInt(hourRaw, 10);
    if (isNaN(day)  || day  < 1  || day  > 28) throw new Error(`Schedule day must be 1–28, got "${dayRaw}"`);
    if (isNaN(hour) || hour < 0  || hour > 23) throw new Error(`Schedule hour must be 0–23, got "${hourRaw}"`);
    // cutoffDay (auto-run plan-run day) — nullable (blank = manual only). If set: 1–28 AND
    // strictly AFTER the reminder day (the three-touch derivation assumes cutoff after ask).
    let cutoffDay: number | null = null;
    if (cutoffRaw) {
      cutoffDay = parseInt(cutoffRaw, 10);
      if (isNaN(cutoffDay) || cutoffDay < 1 || cutoffDay > 28) throw new Error(`Plan-run day must be 1–28, got "${cutoffRaw}"`);
      if (cutoffDay <= day) throw new Error(`Plan-run day (${cutoffDay}) must be AFTER the reminder day (${day}). Leave it blank to keep manual runs.`);
    }
    contentCycleSchedule = cutoffDay != null ? { day, hour, cutoffDay } : { day, hour };
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
