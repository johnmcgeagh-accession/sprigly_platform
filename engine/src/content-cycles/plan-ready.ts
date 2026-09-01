/**
 * plan-ready.ts — send the plan-ready email once a cycle's phase 2 has SETTLED.
 *
 * The gap this closes: the approval arc (client or auto) sent no plan-ready email at all.
 * The only send site is in the planning worker (planning.ts:1180), and the auto-approve
 * branch returns before ever enqueuing planning (scheduler.ts:283-293) — the two paths are
 * mutually exclusive by construction, so an approved cycle reached no send.
 *
 * ── Why "no posts generating" is NOT the predicate ───────────────────────────────────
 *
 * The fan-out enqueues a shape (caption) job per eligible post, plus a hook job for each
 * CAROUSEL; each reel's hook+script is then written by one combined 'script' job the worker
 * enqueues after that reel's caption lands (script-ready.ts). Only shape writes status:
 * shape.ts moves the post 'generating' → 'new'. hook.ts and script.ts write their own fields
 * and NEVER touch status. So the moment every shape job finishes, every post reads 'new' while
 * hook jobs and reel script jobs are still queued — a post-status-only predicate would fire the
 * email while half the reels have no script yet.
 *
 * The predicate is therefore both halves:
 *   1. no live post still in 'generating'  (the DB half)
 *   2. no pending shape/hook/script job keyed to this cycle  (the queue half)
 *
 * The combined reel job is a 'script' job, so it is already one of GENERATION_JOB_KINDS: a reel
 * whose combined job is queued keeps the cycle unsettled until that job finishes — exactly the
 * guarantee the old separate script job gave, with one job type instead of two.
 *
 * 'generation_failed' settles. It is terminal — nothing retries it, the post is
 * client-visible with its error, and a month with one broken caption is still a month the
 * client should be told about. Waiting for it would mean never sending.
 *
 * Jobs in 'failed' are likewise terminal (BullMQ only lands there once attempts are
 * exhausted); a job with retries left sits in 'delayed' or 'waiting', which DO block.
 *
 * ── Why it is gated on approval ──────────────────────────────────────────────────────
 *
 * Settlement runs after EVERY per-post generation job, including a one-off caption rewrite
 * a client asks for months later. Without a gate, such an edit on a cycle that never sent
 * would fire "your plan is ready" for a plan nobody approved. approved_at is stamped by the
 * approval core for BOTH client and auto approvals (draft-approval-core.ts:142), so gating
 * on it selects exactly the arc this fixes and excludes the baseline path, which keeps its
 * own send.
 */
import { and, eq, isNull, isNotNull, sql as dsql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { contentCycles, contentCyclePosts, clients, claimPlanReadySend, releasePlanReadySend, hasGeneratingPosts, auditLog, excludeDraftPosts } from '@sprigly/db';
import { ensureAppLink, monthLabelOf, nextMonth, sendAppReadyNotification, type PlanningDeps } from './planning.js';
import { UNGROUNDED_KEY, ungroundedEmailMerge } from '@sprigly/engine/generation-recovery';
// The preview renders through the SAME two functions the delivery path uses, so what it shows
// is what would be sent rather than a second opinion about it.
import { getPublishedTemplate } from './email-send.js';
import { renderEmailTemplate, briefAskCoverage } from '@sprigly/engine';
import type { AskCoverage, AskCoveragePost } from '@sprigly/engine';

export { claimPlanReadySend, releasePlanReadySend };

/** Job kinds whose ids embed a cycle id and whose completion can settle a cycle. */
export const GENERATION_JOB_KINDS = ['shape', 'hook', 'script'] as const;
export type GenerationJobKind = (typeof GENERATION_JOB_KINDS)[number];

/**
 * BullMQ states that mean "this job has not finished yet".
 *
 * 'completed' and 'failed' are excluded deliberately: both are terminal, and
 * GENERATION_JOB_OPTIONS keeps completed jobs around for an hour
 * (removeOnComplete.age 3600), so counting them would keep a cycle unsettled long after
 * its work was done.
 */
const PENDING_STATES = ['waiting', 'delayed', 'active', 'paused', 'prioritized'] as const;

/**
 * Does this job id belong to a generation job for this cycle?
 *
 * Pure, so the id contract is testable without Redis. Ids are `<kind>_<cycleId>_<postId>`
 * (queue.ts:28,128,185) — underscore-separated because BullMQ forbids colons in custom ids
 * (job-options.ts:20). The trailing separator matters: it stops `weekly_<cycleId>_...`
 * and `planning_<cycleId>` — neither a generation job — from matching.
 */
export function isGenerationJobForCycle(jobId: string | undefined, cycleId: string): boolean {
  if (!jobId) return false;
  return GENERATION_JOB_KINDS.some((kind) => jobId.startsWith(`${kind}_${cycleId}_`));
}

/** The queue half of the predicate. `excludeJobId` drops the job asking the question. */
export async function hasPendingGenerationJobs(
  queue: Queue, cycleId: string, excludeJobId?: string,
): Promise<boolean> {
  const jobs = await queue.getJobs([...PENDING_STATES]);
  return jobs.some((j) => j.id !== excludeJobId && isGenerationJobForCycle(j.id, cycleId));
}

/**
 * The DB half. Soft-deleted posts are not work in flight.
 *
 * Lives in @sprigly/db now and is re-exported here so this module still reads as the home of
 * the predicate. The app asks the same question while a client watches a month fill in, and
 * "is this cycle still working" decides both whether they get an email and whether their
 * screen is honest — one rule, not two copies of one COUNT.
 */
export { hasGeneratingPosts };

/** Both halves. A cycle is settled when nothing is generating and nothing is queued. */
export async function isCycleSettled(
  db: PlanningDeps['db'], queue: Queue, cycleId: string, excludeJobId?: string,
): Promise<boolean> {
  if (await hasGeneratingPosts(db, cycleId)) return false;
  return !(await hasPendingGenerationJobs(queue, cycleId, excludeJobId));
}

/** Declined launch beats in a cycle: live rows carrying the ungrounded flag. */
export async function countUngroundedPosts(db: PlanningDeps['db'], cycleId: string): Promise<number> {
  const [row] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      dsql`${contentCyclePosts.sourceMeta} ->> ${UNGROUNDED_KEY} = 'true'`,
      isNull(contentCyclePosts.deletedAt),
    ));
  return row?.n ?? 0;
}

/**
 * The month as the client will read it: every live, non-draft post's delivered text.
 *
 * Drafts are excluded through the shared predicate for the reason every plan reader excludes
 * them — a beat nobody approved is not part of the month, and counting one would let an
 * unapproved proposal answer for a briefed ask. Soft-deleted rows go for the same reason
 * `countUngroundedPosts` drops them: a post the client deleted is not delivery.
 *
 * `title` lives in `source_meta`, not a column, so it is read out of the jsonb rather than
 * selected — briefAskCoverage reads it for the title-echo signal.
 */
export async function loadAskCoveragePosts(
  db: PlanningDeps['db'], cycleId: string,
): Promise<AskCoveragePost[]> {
  const rows = await db
    .select({
      title:   dsql<string | null>`${contentCyclePosts.sourceMeta} ->> ${'title'}`,
      caption: contentCyclePosts.caption,
      hook:    contentCyclePosts.hook,
      script:  contentCyclePosts.script,
      overlay: contentCyclePosts.overlay,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      isNull(contentCyclePosts.deletedAt),
      excludeDraftPosts(),
    ));
  return rows;
}

/**
 * The audit row's body.
 *
 * Pure, and separated from the write so the thing worth getting right can be tested without a
 * database. What it stores is the module's OWN output rather than a re-reading of it: verdict
 * plus the three evidence numbers briefAskCoverage produced. Recomputing "why" here would be a
 * second copy of the thresholds, free to drift from the first, and an audit row that disagrees
 * with the detector is worse than no row.
 *
 * Asks are ordered unused → unmeasured → used, because the first is the finding and the last is
 * the reassurance, and an operator scanning a row should meet them in that order.
 *
 * Every ask is identifiable from the row alone. A quoted one carries `line` — the client's own
 * sentence, which is both what she asked for and what went missing, and a better handle than her
 * note would be. A thematic one carries `type` and the cycle id, and no note: notes are NOT
 * keyable by type (one live UAT brief types two different asks `feature`), so copying them in
 * could label a row with the wrong ask's words, and a wrong quotation is worse than none.
 */
export function askCoverageMetadata(
  cycleId: string, planMonth: string, postsMeasured: number, coverage: AskCoverage,
): Record<string, unknown> {
  const RANK: Record<string, number> = { unused: 0, unmeasured: 1, used: 2 };
  const asks = [...coverage.items]
    .sort((a, b) => (RANK[a.verdict] ?? 3) - (RANK[b.verdict] ?? 3))
    .map((i) => ({
      type:    i.type,
      product: i.product,
      verdict: i.verdict,
      // The evidence, exactly as the detector reported it.
      longestRun:   i.longestRun,
      contentWords: i.contentWords,
      titleEcho:    i.titleEcho,
      // A quoted ask carries the client's own sentence — the exact words that went missing,
      // which identifies it better than its note would. A thematic ask carries none, and is
      // identified by `type` plus the cycle id: the brief is one query away and its notes are
      // NOT keyable by type (two asks on one live UAT brief are both typed `feature`), so
      // copying them in here would risk labelling a row with the wrong ask's words.
      ...(i.quotedLine ? { line: i.quotedLine } : {}),
    }));
  return {
    cycleId,
    planMonth,
    postsMeasured,
    counts: {
      used:       coverage.used.length,
      unused:     coverage.unused.length,
      unmeasured: coverage.unmeasured.length,
    },
    asks,
  };
}

/**
 * Measure the delivered month against the brief's undated asks, and record what it found.
 *
 * WHEN IT WRITES. Whenever the brief carried asks at all — a clean month writes a row saying so,
 * and a month with no asks writes nothing. Findings-only was the alternative and it breaks the
 * one property this detector is built around: `unused` is conclusive but silence is not, so an
 * absent row must never be readable as "nothing was missing". Writing only on findings would
 * make "measured, nothing conclusive" and "never measured at all" the same absence, which is
 * exactly the misreading that let September look complete. A month with NO asks is skipped
 * because there was genuinely nothing to measure, not because nothing was found. The volume is
 * one row per delivered month per client.
 *
 * NEVER THROWS, and never returns anything the caller must handle. It runs after the email has
 * already gone; a measurement that can fail the delivery it measures is worse than the gap it
 * reports (the reasoning `recordExtractOutcome` gives for the same posture on the intake path).
 * Every failure mode — the read, the detector, the insert — lands in the same catch and leaves
 * a warn behind, so a month that was not measured says so in the log rather than looking clean.
 */
export async function recordAskCoverage(
  deps: PlanningDeps, clientId: string, cycleId: string, planMonth: string, brief: unknown,
): Promise<void> {
  const { db, logger } = deps;
  try {
    const posts    = await loadAskCoveragePosts(db, cycleId);
    const coverage = briefAskCoverage(brief, posts);
    if (coverage.items.length === 0) return;   // no asks briefed — nothing to measure

    const metadata = askCoverageMetadata(cycleId, planMonth, posts.length, coverage);
    await db.insert(auditLog).values({
      clientId, action: 'content-cycle:ask-coverage-outcome', metadata,
    });

    if (coverage.unused.length > 0) {
      logger.warn(
        { cycleId, planMonth, unused: coverage.unused, unmeasured: coverage.unmeasured },
        'plan-ready: briefed content asks reached no post in the delivered month',
      );
    }
  } catch (err) {
    logger.warn({ cycleId, planMonth, err: String(err) }, 'plan-ready: ask-coverage measurement failed — non-fatal, month unaffected');
  }
}

export type SettleOutcome =
  | 'sent'
  | 'not_settled'    // work still in flight
  | 'not_approved'   // baseline cycle, or an ad-hoc edit — not this path's to announce
  | 'already_sent'   // another worker claimed it, or the baseline already sent
  | 'send_failed'    // claimed, transport refused, claim released — a later pass retries
  | 'no_link';       // no app link yet — do not claim, so a later job can try again

/**
 * Settle one cycle: check, claim, send. Safe to call after every generation job.
 *
 * Claim happens BEFORE the send, which trades "a lost email if the send throws" for
 * "never a double email". That trade is only sound because deliverTemplatedEmail is
 * best-effort and never throws (planning.ts:688-691) — a failure is logged, not raised.
 */
export async function settlePlanReady(
  deps: PlanningDeps, queue: Queue, cycleId: string, excludeJobId?: string,
): Promise<SettleOutcome> {
  const { db, logger } = deps;

  const [cycle] = await db
    .select({
      id: contentCycles.id, clientId: contentCycles.clientId, cycleMonth: contentCycles.cycleMonth,
      approvedAt: contentCycles.approvedAt, approvedBy: contentCycles.approvedBy,
      planReadySentAt: contentCycles.planReadySentAt,
      // Read here so the coverage measurement below costs no second round trip. The preview
      // twin deliberately does NOT select it: it neither measures nor records.
      structuredBrief: contentCycles.structuredBrief,
    })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  if (!cycle) return 'not_approved';
  if (cycle.approvedAt == null) return 'not_approved';
  if (cycle.planReadySentAt != null) return 'already_sent';
  if (!(await isCycleSettled(db, queue, cycleId, excludeJobId))) return 'not_settled';

  const appBaseUrl = deps.appBaseUrl ?? process.env['APP_BASE_URL'] ?? '';
  const appUrl = await ensureAppLink(db, cycle.clientId, cycleId, appBaseUrl, logger);
  if (!appUrl) {
    logger.warn({ cycleId }, 'plan-ready: settled but no app link — not claiming, will retry on the next job');
    return 'no_link';
  }

  if (!(await claimPlanReadySend(db, cycleId))) return 'already_sent';

  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, cycle.clientId))
    .limit(1);

  // The auto variant tells the client the month went ahead without them. Deriving it from
  // the stamp the approval core wrote is the only way it can be true.
  const autoApproved = cycle.approvedBy === 'auto';
  const monthLabel   = monthLabelOf(nextMonth(cycle.cycleMonth));

  // Claim-first still holds the concurrency line; what changes is that a claim which does
  // not turn into a delivery is GIVEN BACK. Before this the send's result was discarded and
  // the next line logged 'settled and sent' unconditionally — for earl-of-east it logged
  // exactly that, one line after 'No Gmail tokens for client'.
  /**
   * How much of this month is waiting on the client.
   *
   * Read HERE rather than passed in, because settlement is the one place that knows the month is
   * finished — every other caller of the notification is mid-arc. Counted off the same flag the
   * card reads, so the email and the plan can never disagree about how many there are.
   *
   * Soft-deleted rows are excluded for the reason `hasGeneratingPosts` excludes them: a post the
   * client has deleted is not waiting on anybody.
   */
  const waitingCount = await countUngroundedPosts(db, cycleId);

  const sent = await sendAppReadyNotification(deps, cycle.clientId, client?.name ?? '', monthLabel, appUrl, autoApproved, 'there', waitingCount);
  if (!sent) {
    await releasePlanReadySend(db, cycleId);
    logger.warn({ cycleId, autoApproved, monthLabel }, 'plan-ready: send failed — claim released, will retry');
    return 'send_failed';
  }

  logger.info({ cycleId, autoApproved, monthLabel }, 'plan-ready: settled and sent');

  /**
   * Did the month that just went out carry what the client asked for?
   *
   * HERE, and not one line earlier, because `claimPlanReadySend` already does the work that
   * would otherwise need doing again. Settlement runs after EVERY generation job; the claim is
   * the single conditional UPDATE that lets exactly one of those callers past, so recording on
   * this side of it gives exactly one row per delivered month with no second dedup key. Before
   * the claim would measure on every job. Between the claim and the send would double-record on
   * the send_failed path, which releases the claim so a later pass re-enters.
   *
   * Awaited rather than floated: the email has already gone, so nothing the client sees waits on
   * it, and a floated promise would let the worker move on mid-insert. It cannot throw.
   */
  await recordAskCoverage(deps, cycle.clientId, cycleId, nextMonth(cycle.cycleMonth), cycle.structuredBrief);

  return 'sent';
}

/**
 * THE SAME DECISION AND THE SAME WORDS, WITHOUT CLAIMING OR SENDING.
 *
 * `settlePlanReady` is claim-first: it stamps `plan_ready_sent_at` BEFORE the send, trading a
 * lost email for never a double one. That is the right trade and it makes the live path
 * unusable for looking — you cannot ask "what would this say?" without either sending it or
 * burning the cycle's one claim.
 *
 * So this walks the identical reads in the identical order and stops at the edge: it resolves
 * the same app link, counts the same declined posts through the same `countUngroundedPosts`, and
 * renders the same published template through the same `renderEmailTemplate`. What it does not
 * do is call `claimPlanReadySend` or hand anything to Gmail.
 *
 * It reports `wouldSend` rather than deciding for the reader. A cycle that is `not_settled` or
 * `already_sent` still renders — seeing the copy for a month that is not ready yet is a normal
 * thing to want, and refusing would make this useful only when it is least needed.
 *
 * The one thing it CANNOT tell you is whether the transport works. `send_failed` is invisible
 * from here by construction, because not sending is the point.
 */
export interface PlanReadyPreview {
  cycleId:       string;
  /** What `settlePlanReady` would return if it ran right now — `sent` meaning it would try. */
  wouldSend:     SettleOutcome;
  monthLabel:    string;
  autoApproved:  boolean;
  /** Declined launch beats, the count that drives the waiting copy. */
  waitingCount:  number;
  appUrl:        string | null;
  merge:         Record<string, string>;
  templateKey:   string;
  subject:       string | null;
  body:          string | null;
  /** Why there is no rendered body, when there is none. */
  note?:         string;
}

export async function previewPlanReady(
  deps: PlanningDeps, queue: Queue, cycleId: string,
): Promise<PlanReadyPreview | null> {
  const { db, logger } = deps;

  const [cycle] = await db
    .select({
      id: contentCycles.id, clientId: contentCycles.clientId, cycleMonth: contentCycles.cycleMonth,
      approvedAt: contentCycles.approvedAt, approvedBy: contentCycles.approvedBy,
      planReadySentAt: contentCycles.planReadySentAt,
    })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);
  if (!cycle) return null;

  const wouldSend: SettleOutcome =
    cycle.approvedAt == null ? 'not_approved'
    : cycle.planReadySentAt != null ? 'already_sent'
    : !(await isCycleSettled(db, queue, cycleId)) ? 'not_settled'
    : 'sent';

  const appBaseUrl = deps.appBaseUrl ?? process.env['APP_BASE_URL'] ?? '';
  const appUrl = await ensureAppLink(db, cycle.clientId, cycleId, appBaseUrl, logger);

  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, cycle.clientId))
    .limit(1);

  const autoApproved = cycle.approvedBy === 'auto';
  const monthLabel   = monthLabelOf(nextMonth(cycle.cycleMonth));
  const waitingCount = await countUngroundedPosts(db, cycleId);
  const templateKey  = autoApproved ? 'plan_ready_auto' : 'plan_ready';

  // The SAME merge object `sendAppReadyNotification` builds, field for field. Written here
  // rather than exported from there because that function's job is to deliver, and giving it a
  // "build but do not send" mode is how a send path acquires a branch that can be taken by
  // accident in production.
  const merge: Record<string, string> = {
    clientName: client?.name ?? '',
    monthLabel,
    appLink: appUrl ?? '',
    contactName: 'there',
    ...ungroundedEmailMerge(waitingCount),
  };

  const base = { cycleId, wouldSend, monthLabel, autoApproved, waitingCount, appUrl, merge, templateKey };

  const tpl = await getPublishedTemplate(db, templateKey);
  if (!tpl) return { ...base, subject: null, body: null, note: `no published template for "${templateKey}"` };
  try {
    const { subject, body } = renderEmailTemplate(tpl, merge as never);
    return { ...base, subject, body };
  } catch (err) {
    return { ...base, subject: null, body: null, note: `template render failed: ${String(err)}` };
  }
}

/**
 * Cap on one sweep pass. Not a rate limit — a guard against an unbounded scan if something
 * upstream starts leaving cycles unsent en masse. A capped pass says so in the log rather
 * than reporting a clean run over a truncated list.
 */
const SWEEP_LIMIT = 50;

/**
 * Daily sweep: approved cycles that settled but never got their email.
 *
 * The retry arm of the release added above. A send can fail for reasons that are fixed
 * elsewhere and later — earl-of-east's failed because the client had no Gmail connection at
 * all, which is an operational fix, not a code one. Without a sweep the cycle would stay
 * unsent forever, because the only thing that used to call settlePlanReady was a generation
 * job completing, and those are long finished by the time anyone connects an account.
 *
 * No backoff machinery: the tick runs once a day, and once a day IS the backoff. Each
 * attempt logs, so a cycle failing repeatedly is visible rather than silent.
 *
 * Candidate selection is deliberately loose — approved, not yet sent. Everything that makes
 * a send correct (settled, has a link, not already claimed) is re-checked by settlePlanReady
 * itself, so the sweep cannot send anything a live settlement would not have.
 */
export async function sweepUnsentPlanReady(
  deps: PlanningDeps, queue: Queue,
): Promise<{ considered: number; sent: number; capped: boolean }> {
  const { db, logger } = deps;

  const candidates = await db
    .select({ id: contentCycles.id })
    .from(contentCycles)
    .where(and(
      isNotNull(contentCycles.approvedAt),
      isNull(contentCycles.planReadySentAt),
    ))
    .limit(SWEEP_LIMIT + 1);

  const capped = candidates.length > SWEEP_LIMIT;
  const batch  = capped ? candidates.slice(0, SWEEP_LIMIT) : candidates;
  if (capped) {
    logger.warn({ limit: SWEEP_LIMIT }, 'plan-ready sweep: more unsent cycles than the pass cap — the rest wait for tomorrow');
  }

  let sent = 0;
  for (const c of batch) {
    try {
      const outcome = await settlePlanReady(deps, queue, c.id);
      if (outcome === 'sent') sent++;
      logger.info({ cycleId: c.id, outcome }, 'plan-ready sweep: attempted');
    } catch (err) {
      // One cycle's failure must not end the pass for the rest.
      logger.warn({ cycleId: c.id, err: String(err) }, 'plan-ready sweep: attempt threw (non-fatal)');
    }
  }

  logger.info({ considered: batch.length, sent, capped }, 'plan-ready sweep: done');
  return { considered: batch.length, sent, capped };
}
