/**
 * draft-approval-core.ts — the approval rules, in ONE place.
 *
 * Build D shipped this logic twice: once in `app/src/lib/draft-approval.ts` for the client
 * pressing the button, once in `engine/.../draft-plan.ts` for the D3 cutoff auto-approval.
 * The duplication was forced (the worker cannot import from `app/`) and recorded as the
 * first place the two paths would drift. This is that fix.
 *
 * ── Why @sprigly/engine and not @sprigly/db ──────────────────────────────────
 * The existing dependency direction is engine → db (packages/engine/package.json lists
 * @sprigly/db; the reverse does not exist), so engine can import the tables it needs while
 * db stays a leaf. And `intake-signals.ts` already sets the precedent for a shared
 * DB-querying domain helper living here. Putting business rules in @sprigly/db would make
 * the schema package own decisions about when a month may be approved, which inverts what
 * that package is for.
 *
 * Both call sites keep only their TRANSPORT differences: the app returns an HTTP-shaped
 * result and fans out through its queue helpers; the worker enqueues on the BullMQ handle
 * it already holds. Neither owns a rule.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import { contentCycles, contentCyclePosts, POST_STATUS_DRAFT, PRE_PLANNING_STATUSES } from '@sprigly/db';

/** The status an approved beat takes.
 *
 *  Not invented for the draft arc — it is what the shipped generation path already uses:
 *    app/src/lib/mutations.ts:203   addGeneratingPost inserts status:'generating'
 *    engine/.../shape.ts:127        isGenerating = status is 'generating'|'generation_failed'
 *    engine/.../shape.ts:156        success → 'new' | 'edited'
 *    engine/.../shape.ts:191        failure → 'generation_failed' (final attempt only)
 */
export const POST_STATUS_GENERATING = 'generating' as const;

export type ApprovalError =
  | 'no_cycle'
  | 'no_draft'          // nothing to approve
  | 'mixed_state'       // committed posts already exist — this is not a draft month
  | 'already_approved'  // idempotency: a second press is not a second approval
  | 'cutoff_passed';    // manual approval only; the auto path bypasses this deliberately

export type ApprovalResult =
  | { ok: true; approved: number; postIds: string[] }
  | { ok: false; error: ApprovalError; message: string };

export const APPROVAL_MESSAGES: Record<ApprovalError, string> = {
  no_cycle:         'We couldn’t find that month.',
  no_draft:         'There’s no draft to approve.',
  mixed_state:      'This month already has a plan, so there’s nothing to approve.',
  already_approved: 'You’ve already approved this month — we’re writing it now.',
  cutoff_passed:    'This month has already gone ahead.',
};

const fail = (error: ApprovalError): ApprovalResult => ({ ok: false, error, message: APPROVAL_MESSAGES[error] });

/** Minimal DB surface the core needs. Structurally satisfied by the Drizzle handle both
 *  callers already hold, so neither has to import a type it does not otherwise use. */
export interface ApprovalDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: (fn: (tx: any) => Promise<unknown>) => Promise<unknown>;
}

export interface ApproveDraftParams {
  clientId: string;
  cycleId:  string;
  /**
   * D3: the cutoff arrived with the draft unapproved, so we go ahead on the client's
   * behalf. Skips the cutoff guard (being at cutoff is the whole trigger) and stamps
   * approved_by='auto' so the plan-ready email can say so rather than implying they chose.
   */
  auto?:    boolean;
  now?:     Date;
}

/**
 * Approve a cycle's draft. The ONLY writer anywhere that changes a draft row's status.
 *
 * ATOMIC: every draft row transitions, or none does. A half-approved month would leave some
 * beats generating and some still draft, which no reader in the system can render honestly —
 * the surface would show a draft while the generator wrote into it.
 *
 * IDEMPOTENT-BY-REJECTION on a second call, not silently repeated. Chosen because approval
 * SPENDS MONEY: a double-press that quietly returned success would be indistinguishable
 * from a double fan-out, and paying twice is a worse failure than an explicit "already
 * approved" the client can read.
 */
export async function approveDraftCore(db: ApprovalDb, params: ApproveDraftParams): Promise<ApprovalResult> {
  const { clientId, cycleId, auto = false } = params;
  const now = params.now ?? new Date();

  const [cycle] = await db
    .select({ id: contentCycles.id, status: contentCycles.status, approvedAt: contentCycles.approvedAt })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  if (!cycle) return fail('no_cycle');
  if (cycle.approvedAt) return fail('already_approved');

  // Manual approval is a pre-cutoff right. The auto path deliberately bypasses this: it
  // fires AT cutoff, which would otherwise be exactly the moment it is refused.
  if (!auto && !PRE_PLANNING_STATUSES.has(cycle.status)) return fail('cutoff_passed');

  const drafts = await db
    .select({ id: contentCyclePosts.id })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ));
  if (drafts.length === 0) return fail('no_draft');

  // Mixed state: committed posts already exist alongside the drafts. Approving would produce
  // a month half generated-from-beats and half whatever was there before, with nothing
  // downstream able to tell them apart. Refuse rather than merge.
  const [committed] = await db
    .select({ id: contentCyclePosts.id })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      ne(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  if (committed) return fail('mixed_state');

  await db.transaction(async (tx) => {
    await tx.update(contentCyclePosts)
      .set({ status: POST_STATUS_GENERATING })
      .where(and(
        eq(contentCyclePosts.cycleId, cycleId),
        eq(contentCyclePosts.clientId, clientId),
        eq(contentCyclePosts.status, POST_STATUS_DRAFT),   // re-checked IN the write
        isNull(contentCyclePosts.deletedAt),
      ));
    await tx.update(contentCycles)
      .set({ approvedAt: now, approvedBy: auto ? 'auto' : 'client', updatedAt: now })
      .where(eq(contentCycles.id, cycleId));
  });

  return { ok: true, approved: drafts.length, postIds: drafts.map((d: { id: string }) => d.id) };
}
