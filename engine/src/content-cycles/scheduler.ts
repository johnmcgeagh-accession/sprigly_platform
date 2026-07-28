/**
 * scheduler.ts — Content-cycle scheduler for the 'content-cycles' BullMQ queue.
 *
 * enqueueCycleForClient:  shared enqueue path used by the tick AND any future manual trigger.
 *   - DB-level dedup: skips if a content_cycles row already exists in 'requested' (or beyond).
 *   - Seeds a 'scheduled' cycle row so runRequestEmail can find it when the chain completes.
 *   - BullMQ dedup: uses a deterministic jobId so re-enqueues are no-ops while the job is pending.
 *
 * runContentCycleTick:  called by the 'scheduler-tick' BullMQ repeatable job (05:00 Europe/London).
 *   - Queries clients WHERE content_cycle_enabled = true. Zero clients are enabled by default.
 *   - Reads content_cycle_schedule from client_channels (DB column, not Drive).
 *   - Skips clients not yet due this calendar month (today's London day < schedule.day).
 *   - Calls enqueueCycleForClient for each due client.
 *
 * SAFETY: content_cycle_enabled defaults to false in the DB. Nothing in this file sets it to true.
 *         No client runs automatically until the column is explicitly enabled per-row in the DB.
 */

import { eq, and } from 'drizzle-orm';
import { db as _db, clients, clientChannels, contentCycles, type EmailTemplateKey } from '@sprigly/db';
import { questionsForChannel, deriveTouchSchedule, dueTouchForDay, type Touch, type MergeData } from '@sprigly/engine';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { IG_TRAWL_JOB_OPTIONS, igTrawlJobId, PLANNING_JOB_OPTIONS, planningJobId } from './job-options.js';
import { transitionCycle } from './machine.js';
import { hasSuppressibleInput } from '@sprigly/engine';

type Db = typeof _db;

/** Injected send capability (constructed in the consumer with real Gmail deps): resolve +
 *  render + deliver a templated email to the pinned inbox. Returns true on a confirmed send. */
/** D3: how the scheduler auto-approves a draft at cutoff. Injected, never imported. */
export interface AutoApproveFns {
  /** Live, unapproved draft beats on this cycle. 0 → the baseline path applies. */
  countDrafts: (cycleId: string) => Promise<number>;
  /** Approve (auto) + fan out phase 2. */
  approveAndGenerate: (clientId: string, cycleId: string) => Promise<{ approved: number; captionsQueued: number }>;
}

export type SendTemplatedEmailFn = (input: { key: EmailTemplateKey; clientId: string; merge: MergeData }) => Promise<boolean>;

/**
 * Assemble + persist a draft plan for a cycle, returning a one-line summary for the Ask
 * email. INJECTED rather than imported so the scheduler keeps no dependency on the model
 * client, and so the failure-isolation branch below is directly testable.
 *
 * May throw. The Ask touch treats a throw as "no draft this month" and sends the ordinary
 * Ask email — a draft is an enhancement to the touch, never a precondition for it.
 */
export type AssembleDraftFn = (clientId: string, cycleId: string) => Promise<{ summary: string }>;
/** Injected app-link resolver (planning.ensureAppLink), so the scheduler stays free of the
 *  heavy planning module. Returns the /p/<token> URL for the cycle, or null. */
export type ResolveAppLinkFn = (clientId: string, cycleId: string) => Promise<string | null>;

/** Payload for the optional post-go-live operator notify hook (auto-run). */
export interface AutoRunNotifyInfo {
  clientId:      string;
  channel:       string;
  cycleId:       string;
  dataMonth:     string;
  monthLabel:    string;
  intakePresent: boolean;
}

// Statuses indicating the cycle for this (client, channel, month) is already underway.
// 'scheduled'  is intentionally absent: the row exists but the BullMQ job may have been
//              lost from Redis. We re-enqueue; the deterministic jobId prevents duplication.
// 'failed'     is intentionally absent: allows the scheduler to retry a failed cycle next tick.
const ACTIVE_STATUSES: ReadonlyArray<string> = [
  'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed',
  'planning', 'workbook_built', 'delivered', 'active', 'finalised',
  'awaiting_voice_approval', 'voice_merged', 'closed',
];

export interface CycleSchedule {
  day:  number;  // day-of-month (1–28) on which the cycle triggers CREATION (the ask-chain)
  hour: number;  // hour in Europe/London (stored; not used by the daily tick currently)
  // Auto-run (intake-capture): day-of-month the plan RUN fires (cutoff). Optional —
  // null/absent ⇒ auto-run is not configured for this client (the default). `day` above
  // stays the reminder/ask date; unchanged semantics.
  cutoffDay?: number | null;
}

const DEFAULT_SCHEDULE: CycleSchedule = { day: 1, hour: 6 };

// ── Auto-run (intake-capture) — SHIPS DARK in this build ──────────────────────
// Master switch. Default OFF (only 'true' enables). While false the auto-run branch takes
// NO action — it logs, at info, exactly what it WOULD do. Flipping this env var to 'true' is
// the switch that makes the run fire (the pinned notification is wired at the tick call site).
const AUTO_RUN_ENABLED = process.env.AUTO_RUN_ENABLED === 'true';
const AUTO_RUN_DRY_PREFIX = '[auto-run:dry]';

// A cycle is auto-runnable only from a status BEFORE intake_confirmed — i.e. the ask-chain
// ran (or hasn't) but the plan hasn't been confirmed/started. At intake_confirmed or beyond
// there is nothing to auto-advance.
const AUTO_RUN_PRESTART_STATUSES: ReadonlyArray<string> = [
  'scheduled', 'requested', 'reply_received', 'awaiting_confirmation',
];

/**
 * The ordered machine edges auto-run would traverse to reach intake_confirmed from a given
 * pre-start status. All of these edges already exist (machine.ts) — this build never adds a
 * transition. scheduled advances through requested (run-anyway: empty intake is the valid
 * baseline). Returns "from->to" strings for logging + (when live) sequential transitionCycle.
 */
export function planAutoRunTransitions(from: string): string[] {
  switch (from) {
    case 'scheduled':             return ['scheduled->requested', 'requested->intake_confirmed'];
    case 'requested':             return ['requested->intake_confirmed'];
    case 'reply_received':        return ['reply_received->intake_confirmed'];
    case 'awaiting_confirmation': return ['awaiting_confirmation->intake_confirmed'];
    default:                      return [];
  }
}

export function getLondonToday(now: Date = new Date()): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  return {
    year:  parseInt(parts.find(p => p.type === 'year')?.value  ?? '2000', 10),
    month: parseInt(parts.find(p => p.type === 'month')?.value ?? '1',    10),
    day:   parseInt(parts.find(p => p.type === 'day')?.value   ?? '1',    10),
  };
}

// Last completed calendar month: the month before today's.
// e.g. any day in June 2026 → '2026-05';  any day in January 2027 → '2026-12'.
export function getDataMonth(today: { year: number; month: number }): string {
  const y = today.month === 1 ? today.year - 1 : today.year;
  const m = today.month === 1 ? 12             : today.month - 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function isDue(schedule: CycleSchedule, today: { day: number }): boolean {
  return today.day >= schedule.day;
}

// Shared enqueue path used by the scheduler tick and any manual admin trigger.
// Idempotent: calling multiple times for the same (clientId, channel, dataMonth) is safe.
export async function enqueueCycleForClient(params: {
  db:        Db;
  queue:     Queue;
  clientId:  string;
  channel:   string;
  dataMonth: string;
  logger:    Logger;
}): Promise<'enqueued' | 'skipped'> {
  const { db, queue, clientId, channel, dataMonth, logger } = params;
  const logCtx = { clientId, channel, dataMonth };

  // DB-level dedup: skip if the cycle is already active (real guarantee).
  const existingRows = await db
    .select({ status: contentCycles.status })
    .from(contentCycles)
    .where(and(
      eq(contentCycles.clientId,   clientId),
      eq(contentCycles.channel,    channel),
      eq(contentCycles.cycleMonth, dataMonth),
    ))
    .limit(1);

  const existing = existingRows[0];
  if (existing && ACTIVE_STATUSES.includes(existing.status)) {
    logger.info({ ...logCtx, cycleStatus: existing.status },
      'content-cycle-scheduler: cycle already active — skipping');
    return 'skipped';
  }

  // Seed the cycle row so runRequestEmail (chained after ig-trawl) can find it.
  await db
    .insert(contentCycles)
    .values({ clientId, channel, cycleMonth: dataMonth, status: 'scheduled' })
    .onConflictDoNothing();

  // BullMQ forbids colons in custom jobIds (Redis namespace separator). Use underscore.
  const jobId = igTrawlJobId(clientId, channel, dataMonth);
  await queue.add(
    'ig-trawl',
    { type: 'ig-trawl', clientId, channel, dataMonth },
    { ...IG_TRAWL_JOB_OPTIONS, jobId },
  );

  logger.info({ ...logCtx, jobId }, 'content-cycle-scheduler: enqueued ig-trawl');
  return 'enqueued';
}

/**
 * Auto-run (intake-capture) — SHIPS DARK. For one enabled client+channel whose schedule has
 * a cutoffDay: if the cutoff day is reached AND a cycle for the current data month is still
 * before intake_confirmed, this is where the plan RUN would fire. While AUTO_RUN_ENABLED is
 * false it takes NO action — it logs, at info with the [auto-run:dry] prefix, exactly what it
 * WOULD do (client, cycle, status, transitions, intake-input predicate, enqueue, notify) and
 * returns. Rows without a cutoffDay short-circuit before any DB read.
 */
export async function evaluateAutoRunForClient(params: {
  db:        Db;
  queue:     Queue;
  clientId:  string;
  channel:   string;
  dataMonth: string;
  schedule:  CycleSchedule;
  today:     { day: number };
  logger:    Logger;
  notify?:   ((info: AutoRunNotifyInfo) => Promise<void>) | undefined;
  /** D3 auto-approve capability. INJECTED so the scheduler keeps no dependency on the app's
   *  approval/generation modules, and so the branch is directly testable. */
  autoApprove?: AutoApproveFns | undefined;
}): Promise<'dry' | 'ran' | 'skipped'> {
  const { db, queue, clientId, channel, dataMonth, schedule, today, logger, notify, autoApprove } = params;
  const logCtx = { clientId, channel, dataMonth };

  const cutoffDay = schedule.cutoffDay ?? null;
  if (cutoffDay == null) return 'skipped';       // auto-run not configured for this client
  if (today.day < cutoffDay) return 'skipped';   // cutoff not reached yet this month

  const [cycle] = await db
    .select({
      id:         contentCycles.id,
      status:     contentCycles.status,
      intakeJson: contentCycles.intakeJson,
      createdAt:  contentCycles.createdAt,
      clientId:   contentCycles.clientId,
    })
    .from(contentCycles)
    .where(and(
      eq(contentCycles.clientId,   clientId),
      eq(contentCycles.channel,    channel),
      eq(contentCycles.cycleMonth, dataMonth),
    ))
    .limit(1);

  if (!cycle) {
    logger.info({ ...logCtx, cutoffDay, todayDay: today.day },
      'content-cycle-scheduler: auto-run cutoff reached but no cycle for data month — nothing to run');
    return 'skipped';
  }
  if (!AUTO_RUN_PRESTART_STATUSES.includes(cycle.status)) return 'skipped';  // confirmed or beyond

  const transitions    = planAutoRunTransitions(cycle.status);
  const hasIntakeInput = await hasSuppressibleInput(db, { clientId: cycle.clientId, createdAt: cycle.createdAt, intakeJson: cycle.intakeJson });
  const monthLabel     = planMonthLabel(dataMonth);   // dataMonth === this cycle's cycleMonth

  // ── D3: auto-approve a draft instead of a baseline run ───────────────────────
  // When the cutoff arrives with an UNAPPROVED draft on the cycle, that draft is what the
  // client was shown and reacted to — it is a far better basis for the month than a
  // baseline whole-plan generation from an empty intake. So we go ahead with it, stamped
  // approved_by='auto' so the plan-ready email can say so rather than implying they chose.
  //
  // This also RETIRES the Build A interim state at its source: a cycle holding drafts can
  // no longer reach the baseline path, so a regen can no longer run alongside surviving
  // invisible draft rows. The baseline remains the path only for cycles with NO draft —
  // flag off, or assembly failed at the Ask touch.
  //
  // AUTO_RUN_ENABLED composition: this branch sits INSIDE the same gate as the baseline
  // enqueue and above the dry-run return, so the flag governs both paths identically.
  // Flag false → we log what we WOULD auto-approve and change nothing. Flag true → we
  // auto-approve and fan out. The flag's value is not read or changed here beyond that.
  const draftCount = autoApprove ? await autoApprove.countDrafts(cycle.id) : 0;

  if (!AUTO_RUN_ENABLED) {
    if (draftCount > 0) {
      logger.info({ ...logCtx, cycleId: cycle.id, draftCount },
        `${AUTO_RUN_DRY_PREFIX} would AUTO-APPROVE ${draftCount} draft beats for cycle ${cycle.id} and fan out phase 2 — NOT the baseline planning run.`);
      return 'dry';
    }
    logger.info({
      ...logCtx,
      cycleId:         cycle.id,
      currentStatus:   cycle.status,
      cutoffDay,
      todayDay:        today.day,
      monthLabel,
      wouldTransition: transitions,
      hasIntakeInput,
      wouldEnqueue:    `planning:${cycle.id}`,
    }, `${AUTO_RUN_DRY_PREFIX} would advance cycle ${cycle.id} ${cycle.status} → intake_confirmed via [${transitions.join(', ')}], then enqueue planning (intake ${hasIntakeInput ? 'present' : 'empty — baseline run'}) and log [auto-run:kicked]. No enqueue-time email — the completion-path plan_ready send (pinned) is the Stage-1 observation.`);
    return 'dry';
  }

  // ── LIVE: draft present → auto-approve, and DO NOT run the baseline ──────────
  if (draftCount > 0 && autoApprove) {
    const outcome = await autoApprove.approveAndGenerate(cycle.clientId, cycle.id);
    logger.info({ ...logCtx, cycleId: cycle.id, monthLabel, ...outcome },
      `[auto-run:auto-approved] approved ${outcome.approved} draft beats and started phase 2 for ${monthLabel} — baseline run skipped`);
    if (notify) {
      try { await notify({ clientId, channel, cycleId: cycle.id, dataMonth, monthLabel, intakePresent: hasIntakeInput }); }
      catch (err) { logger.warn({ ...logCtx, cycleId: cycle.id, err: String(err) }, 'content-cycle-scheduler: auto-run operator notify failed (non-fatal)'); }
    }
    return 'ran';
  }

  // ── LIVE (AUTO_RUN_ENABLED=true) — the BASELINE path, for cycles with no draft ─
  // Uses only existing machine edges + the engine planning enqueue primitive; changes
  // NOTHING in runPlanningForCycle, confirmIntake, or the transition map.
  for (const edge of transitions) {
    const to = edge.split('->')[1] as 'requested' | 'intake_confirmed';
    await transitionCycle(db, cycle.id, to, {}, logger);
  }
  await queue.add('planning', { type: 'planning', cycleId: cycle.id }, { ...PLANNING_JOB_OPTIONS, jobId: planningJobId(cycle.id) });
  // Trigger-time signal is LOG-ONLY (no email): the completion-path plan_ready send (pinned) is
  // the Stage-1 observation. The `notify` hook is kept as a seam so an operator notification can
  // be wired post-go-live — it is intentionally NOT wired to email in this build.
  logger.info({ ...logCtx, cycleId: cycle.id, monthLabel, intakePresent: hasIntakeInput },
    `[auto-run:kicked] advanced ${cycle.status} → intake_confirmed and enqueued planning for ${monthLabel} (intake ${hasIntakeInput ? 'present' : 'empty — baseline run'})`);
  if (notify) {
    try { await notify({ clientId, channel, cycleId: cycle.id, dataMonth, monthLabel, intakePresent: hasIntakeInput }); }
    catch (err) { logger.warn({ ...logCtx, cycleId: cycle.id, err: String(err) }, 'content-cycle-scheduler: auto-run operator notify failed (non-fatal)'); }
  }
  return 'ran';
}

// ── Three-touch reminder sender (intake-capture Build 2) ──────────────────────
// Sends the Ask / Nudge / Last-Call reminder emails, always PINNED to the test inbox with the
// client's Gmail tokens (Stage 1 — no client-facing email). Driven from the tick as a sibling
// pass to the auto-run branch. Clients with no cutoffDay never match → legacy draft path only.

const TOUCH_KEY: Record<Touch, EmailTemplateKey> = { ask: 'ask', nudge: 'nudge', last_call: 'last_call' };

/**
 * Which touch (if any) is due on `todayDay` for this schedule — via the SHARED derivation in
 * @sprigly/engine (deriveTouchSchedule + dueTouchForDay), so the sender and the admin "what
 * fires when" readout can never disagree. Pure — no DB. Null when cutoffDay is unset.
 */
export function dueTouch(schedule: CycleSchedule, todayDay: number): Touch | null {
  return dueTouchForDay(deriveTouchSchedule(schedule.day, schedule.cutoffDay ?? null), todayDay);
}

/** Plan-month label ("August 2026") for a cycle's data month (cycleMonth + 1). */
function planMonthLabel(cycleMonth: string): string {
  const [y, m] = cycleMonth.split('-').map(Number);
  // m is 1-based, so Date.UTC month index m == the NEXT month (the plan month); JS rolls the year.
  return new Date(Date.UTC(y!, m!, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
/** "20 June" for a day-of-month in the tick's current London month. */
function formatCutoffDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
/** Numbered base + extra questions for the Ask email — via the shared derivation, so it matches
 *  the request email / card / panel exactly. NOTE: questionsForChannel string-filters the extras,
 *  which the prior inline spread did not; verified output-identical for all current
 *  client_channels.extra_questions rows (none hold a non-string). */
function buildQuestionsBlock(extraQuestions: readonly unknown[] | null): string {
  return questionsForChannel({ extraQuestions }).map((q, i) => `${i + 1}. ${q}`).join('\n');
}

/**
 * Evaluate + send the three-touch reminder due today for one enabled client+channel with a
 * cutoffDay. Suppresses when any intake input has landed (does NOT stamp — a later tick
 * re-evaluates); stamps make each touch at-most-once; a send failure is non-fatal and does NOT
 * stamp. The intake link homes on the cycle being asked about (the current data month's cycle).
 */
export async function evaluateThreeTouchForClient(params: {
  db:        Db;
  clientId:  string;
  channel:   string;
  dataMonth: string;
  schedule:  CycleSchedule;
  today:     { year: number; month: number; day: number };
  logger:    Logger;
  sendEmail?:      SendTemplatedEmailFn | undefined;
  resolveAppLink?: ResolveAppLinkFn | undefined;
  assembleDraft?:  AssembleDraftFn | undefined;
}): Promise<'sent' | 'skipped'> {
  const { db, clientId, channel, dataMonth, schedule, today, logger, sendEmail, resolveAppLink, assembleDraft } = params;
  const touch = dueTouch(schedule, today.day);
  if (!touch) return 'skipped';   // no touch due today (covers no-cutoffDay clients) — SILENT, no
                                  // stamp: this fires on every non-beat day and must not write.
  const logCtx = { clientId, channel, dataMonth, touch };

  // cycleId is hoisted so the catch can attribute an 'error' skip reason to the row (when known).
  let cycleId: string | null = null;
  try {
    const [cycle] = await db
      .select({
        id: contentCycles.id, status: contentCycles.status, intakeJson: contentCycles.intakeJson,
        createdAt: contentCycles.createdAt, cycleMonth: contentCycles.cycleMonth,
        askSentAt: contentCycles.askSentAt, nudgeSentAt: contentCycles.nudgeSentAt, lastCallSentAt: contentCycles.lastCallSentAt,
      })
      .from(contentCycles)
      .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, dataMonth)))
      .limit(1);
    if (!cycle) { logger.info(logCtx, '[touch:skipped reason=no_cycle]'); return 'skipped'; }  // no row to stamp
    cycleId = cycle.id;

    const alreadySent = touch === 'ask' ? cycle.askSentAt : touch === 'nudge' ? cycle.nudgeSentAt : cycle.lastCallSentAt;
    if (alreadySent != null) { logger.info(logCtx, '[touch:skipped reason=already_sent]'); return 'skipped'; }  // the timestamp IS the state

    // Suppression: any input landed → skip, do NOT stamp *_sent_at (a later tick re-checks). Record
    // the reason so a NULL *_sent_at is legible as "suppressed" rather than "never attempted".
    if (await hasSuppressibleInput(db, { clientId, createdAt: cycle.createdAt, intakeJson: cycle.intakeJson })) {
      logger.info(logCtx, '[touch:skipped reason=has_input]');
      await stampBeatSkip(db, cycle.id, touch, 'has_input');
      return 'skipped';
    }

    if (!sendEmail) {
      logger.warn(logCtx, '[touch:skipped reason=no_sender_wired]');
      await stampBeatSkip(db, cycle.id, touch, 'no_sender_wired');
      return 'skipped';
    }

    const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
    const [chan] = await db
      .select({ contactName: clientChannels.contactName, extraQuestions: clientChannels.extraQuestions })
      .from(clientChannels)
      .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
      .limit(1);

    const appLink   = resolveAppLink ? (await resolveAppLink(clientId, cycle.id)) ?? '' : '';
    const cutoffDay = schedule.cutoffDay ?? 0;

    // ── Draft plan (Build A, D2) ──────────────────────────────────────────────────
    // On the ASK touch only, assemble + persist a draft so the email can carry it. The
    // client then reacts to a month rather than composing one from a blank form.
    //
    // FAILURE ISOLATION IS THE POINT: assembly does model work and several reads, any of
    // which can fail. If it does, we log and fall through to the ORDINARY Ask email,
    // unchanged. The touch schedule is a commitment to the client; a draft is an
    // enhancement to it. Never let the enhancement cost them the touch.
    let beatsSummary = '';
    if (touch === 'ask' && assembleDraft) {
      try {
        beatsSummary = (await assembleDraft(clientId, cycle.id)).summary;
        logger.info({ ...logCtx, beatsSummary }, '[touch:draft-assembled]');
      } catch (err) {
        beatsSummary = '';
        logger.warn({ ...logCtx, err: String(err) }, '[touch:draft-failed] sending the ordinary Ask email');
      }
    }
    // The variant is chosen by whether we ACTUALLY have a draft to describe, not by
    // whether we tried — so a failed assembly can never send an email promising a draft
    // that is not there.
    const templateKey: EmailTemplateKey = touch === 'ask' && beatsSummary ? 'ask_drafted' : TOUCH_KEY[touch];
    const merge: MergeData = {
      contactName:    chan?.contactName ?? 'there',
      clientName:     client?.name ?? 'there',
      monthLabel:     planMonthLabel(cycle.cycleMonth),
      cutoffDate:     formatCutoffDate(today.year, today.month, cutoffDay),
      daysToCutoff:   String(Math.max(0, cutoffDay - today.day)),
      intakeLink:     appLink ? `${appLink}?intake=1` : '',   // lands with the intake surface open
      appLink,
      questionsBlock: touch === 'ask' ? buildQuestionsBlock(chan?.extraQuestions ?? null) : '',
      beatsSummary,
      // leanLine renders blank in this build (its source wires in a later build).
    };

    const ok = await sendEmail({ key: templateKey, clientId, merge });
    if (!ok) {
      logger.warn(logCtx, '[touch:skipped reason=send_failed]');
      await stampBeatSkip(db, cycle.id, touch, 'send_failed');
      return 'skipped';
    }

    // Stamp at-most-once AFTER a confirmed send. Timestamp only — the skip-reason column is left
    // NULL on the sent path (the timestamp is the "sent" signal; a reason would be noise).
    const patch = touch === 'ask' ? { askSentAt: new Date() } : touch === 'nudge' ? { nudgeSentAt: new Date() } : { lastCallSentAt: new Date() };
    await db.update(contentCycles).set(patch).where(eq(contentCycles.id, cycle.id));
    logger.info({ ...logCtx, to: APP_DELIVERY_PIN_LABEL }, '[touch:sent]');
    return 'sent';
  } catch (err) {
    // Record 'error' as the beat's skip reason (best-effort; only when we know the row), then
    // RE-THROW the ORIGINAL error so the tick loop's handler still logs + continues. The stamp is
    // itself guarded: if the DB is what's failing, a failed stamp must not mask the real cause.
    if (cycleId != null) {
      try { await stampBeatSkip(db, cycleId, touch, 'error'); }
      catch (stampErr) { logger.warn({ ...logCtx, stampErr: String(stampErr) }, '[touch:skip-reason stamp failed]'); }
    }
    throw err;
  }
}

// Log-only label (the real pinned address lives in email-send.ts; the scheduler never sends
// directly — it delegates to the injected sendEmail).
const APP_DELIVERY_PIN_LABEL = 'pinned-test-inbox';

// Why a beat left its *_sent_at NULL. Mirrors the send log; recoverable from the DB alone.
// NULL (no row value) = unknown / predates the column. See content_cycles schema + migration 0080.
export type BeatSkipReason = 'has_input' | 'send_failed' | 'no_sender_wired' | 'error';

/**
 * Stamp the per-beat skip reason for `touch`. Mirrors the success-path timestamp stamp
 * (three explicit column branches) but writes the reason column and NEVER touches *_sent_at,
 * so the at-most-once guard (which keys off *_sent_at) is unchanged. This is a NEW write on
 * branches that were previously read-only — it records diagnosis only, never gates sending.
 */
async function stampBeatSkip(db: Db, cycleId: string, touch: Touch, reason: BeatSkipReason): Promise<void> {
  const patch = touch === 'ask'   ? { askSkipReason: reason }
              : touch === 'nudge' ? { nudgeSkipReason: reason }
              :                     { lastCallSkipReason: reason };
  await db.update(contentCycles).set(patch).where(eq(contentCycles.id, cycleId));
}

export async function runContentCycleTick(params: {
  db:     Db;
  queue:  Queue;
  logger: Logger;
  now?:   Date;  // injectable for tests; defaults to new Date()
  // Optional OPERATOR notify hook for a real auto-run (post-go-live seam). NOT wired in this
  // build: the trigger-time signal is the log-only [auto-run:kicked] line, and the completion
  // plan_ready email is the Stage-1 observation. Absent here; the auto-run branch is dark anyway.
  autoRunNotify?: (info: AutoRunNotifyInfo) => Promise<void>;
  // Three-touch reminder send capability + app-link resolver (wired in the consumer where the
  // Gmail/planning deps exist). Absent ⇒ the sender pass logs and sends nothing.
  sendEmail?:      SendTemplatedEmailFn;
  resolveAppLink?: ResolveAppLinkFn;
  // Draft-plan assembly for the Ask touch (Build A). Injected so the scheduler keeps no
  // model dependency; a throw degrades to the ordinary Ask email (see the touch sender).
  assembleDraft?: AssembleDraftFn;
  // D3 auto-approve at cutoff. Absent → the baseline path applies to every cycle, exactly
  // as before this build.
  autoApprove?: AutoApproveFns;
  /**
   * Retry pass for approved cycles that settled but never got their plan-ready email.
   *
   * INJECTED for the same reason the others are: the sweep needs the planning/Gmail deps and
   * the scheduler keeps none. Absent ⇒ no sweep, and the tick behaves exactly as before.
   * The daily cadence IS the backoff — there is no retry machinery behind this.
   */
  sweepPlanReady?: () => Promise<unknown>;
  /**
   * Retry pass for posts whose caption generation ran out of BullMQ retries (spec gap 7).
   *
   * Injected for the same reason its sibling is: the sweep needs the queue and the
   * generation instruction, and the scheduler keeps no dependency on either. Absent ⇒ no
   * sweep, and the tick behaves exactly as before.
   *
   * This is the half that makes the redesign's "on its way" honest. The client no longer has
   * a retry button, so something has to do the retrying — and what it cannot recover has to
   * reach an operator instead.
   */
  sweepFailedGenerations?: () => Promise<unknown>;
}): Promise<void> {
  const { db, queue, logger } = params;
  const now = params.now ?? new Date();

  const today     = getLondonToday(now);
  const dataMonth = getDataMonth(today);   // last COMPLETED month (legacy cohort → plans this month)
  // Intake-workflow cohort (clients WITH a cutoffDay): the cycle_month is the CURRENT month, so
  // the plan targets nextMonth = M+1 (FIX 3). Legacy clients (no cutoffDay) keep the data-month
  // behaviour byte-identically — a cohort split, not a global change.
  const currentMonth = `${today.year}-${String(today.month).padStart(2, '0')}`;
  const cohortMonth = (s: CycleSchedule) => (s.cutoffDay != null ? currentMonth : dataMonth);
  logger.info({ today, dataMonth, currentMonth }, 'content-cycle-scheduler: tick started');

  // Retry unsent plan-ready emails FIRST, so a transport that was fixed since yesterday
  // delivers before the tick spends time on anything else. Best-effort: a sweep failure must
  // never stop the tick's real work.
  if (params.sweepPlanReady) {
    try { await params.sweepPlanReady(); }
    catch (err) { logger.warn({ err: String(err) }, 'content-cycle-scheduler: plan-ready sweep failed (non-fatal)'); }
  }

  // Then the generation retry arm, for the same reason and on the same terms: a caption that
  // ran out of BullMQ attempts overnight gets another go before the tick spends time on new
  // work. Best-effort — a sweep failure must never stop the tick's real work.
  if (params.sweepFailedGenerations) {
    try { await params.sweepFailedGenerations(); }
    catch (err) { logger.warn({ err: String(err) }, 'content-cycle-scheduler: generation sweep failed (non-fatal)'); }
  }

  const enabledRows = await db
    .select({
      clientId:             clientChannels.clientId,
      channel:              clientChannels.channel,
      contentCycleSchedule: clientChannels.contentCycleSchedule,
    })
    .from(clientChannels)
    .innerJoin(clients, eq(clientChannels.clientId, clients.id))
    .where(eq(clients.contentCycleEnabled, true));

  if (enabledRows.length === 0) {
    logger.info({}, 'content-cycle-scheduler: no enabled clients — done');
    return;
  }

  let enqueued = 0;
  let skipped  = 0;

  for (const row of enabledRows) {
    const { clientId, channel, contentCycleSchedule } = row;
    try {
      const schedule: CycleSchedule = contentCycleSchedule ?? DEFAULT_SCHEDULE;
      const cycleMonth = cohortMonth(schedule);   // intake cohort → currentMonth; legacy → dataMonth
      const logCtx = { clientId, channel, dataMonth: cycleMonth };
      if (!contentCycleSchedule) {
        logger.info({ ...logCtx, schedule: DEFAULT_SCHEDULE },
          'content-cycle-scheduler: content_cycle_schedule absent — using default');
      }

      if (!isDue(schedule, today)) {
        logger.info({ ...logCtx, schedule, todayDay: today.day },
          'content-cycle-scheduler: not yet due — skipping');
        skipped++;
        continue;
      }

      const result = await enqueueCycleForClient({ db, queue, clientId, channel, dataMonth: cycleMonth, logger });
      if (result === 'enqueued') enqueued++;
      else skipped++;

    } catch (err) {
      logger.warn({ clientId, channel, err: String(err) },
        'content-cycle-scheduler: error processing client — skipping');
      skipped++;
    }
  }

  // ── Auto-run (intake-capture) — SHIPS DARK. Separate pass so the creation branch above is
  // byte-identical: rows without a schedule.cutoffDay short-circuit inside
  // evaluateAutoRunForClient with NO DB read, so nothing changes for existing clients. ──
  let autoRunDry = 0;
  for (const row of enabledRows) {
    const schedule: CycleSchedule = row.contentCycleSchedule ?? DEFAULT_SCHEDULE;
    try {
      const outcome = await evaluateAutoRunForClient({
        db, queue, clientId: row.clientId, channel: row.channel, dataMonth: cohortMonth(schedule), schedule, today, logger,
        notify: params.autoRunNotify,
        autoApprove: params.autoApprove,
      });
      if (outcome === 'dry') autoRunDry++;
    } catch (err) {
      logger.warn({ clientId: row.clientId, channel: row.channel, dataMonth, err: String(err) },
        'content-cycle-scheduler: auto-run evaluation error — skipping');
    }
  }

  // ── Three-touch reminder pass (intake-capture Build 2). Sibling to auto-run; rows without a
  // cutoffDay short-circuit (dueTouch → null) with NO DB read, so no-cutoffDay clients are
  // untouched. Each touch is at-most-once (send-log stamps) and suppressed once input lands. ──
  let touchSent = 0;
  for (const row of enabledRows) {
    const schedule: CycleSchedule = row.contentCycleSchedule ?? DEFAULT_SCHEDULE;
    try {
      const outcome = await evaluateThreeTouchForClient({
        db, clientId: row.clientId, channel: row.channel, dataMonth: cohortMonth(schedule), schedule, today, logger,
        sendEmail: params.sendEmail, resolveAppLink: params.resolveAppLink,
        assembleDraft: params.assembleDraft,
      });
      if (outcome === 'sent') touchSent++;
    } catch (err) {
      logger.warn({ clientId: row.clientId, channel: row.channel, dataMonth, err: String(err) },
        'content-cycle-scheduler: three-touch evaluation error — skipping');
    }
  }

  logger.info({ dataMonth, currentMonth, enqueued, skipped, autoRunDry, autoRunEnabled: AUTO_RUN_ENABLED, touchSent },
    'content-cycle-scheduler: tick complete');
}
