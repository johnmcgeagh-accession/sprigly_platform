/**
 * activity.ts — append-only writes to the plan_activity ledger (AUDIT.md §3).
 *
 * ONE ordered stream regardless of actor: manual edits record origin='user'; approved
 * agent proposals record origin='agent' + refProposalId. There is intentionally NO
 * update/delete helper — plan_activity is append-only, enforced in the DB by a trigger
 * (migration 0068). recordActivity accepts either the db handle or a transaction, so a
 * write + its ledger row commit atomically (see mutations.ts).
 */
import { db, planActivity } from '@sprigly/db';

/** db handle or an in-flight transaction — both expose `.insert`. */
type Executor = Pick<typeof db, 'insert'>;

export type ActivityOrigin = 'user' | 'agent';

export type ActivityAction =
  | 'post_created'
  | 'rescheduled'
  | 'caption_saved'
  | 'hook_saved'
  | 'script_saved'
  | 'format_changed'
  | 'reordered'
  | 'post_updated'
  | 'post_deleted'
  | 'post_reverted'
  | 'step_completed'
  | 'step_uncompleted'
  | 'step_renamed'
  | 'checklist_generated';

/** Who caused a change, and (for agent changes) which proposal it applied. */
export interface ActivityActor {
  origin: ActivityOrigin;
  refProposalId?: string | null;
}

/** The default attribution for a direct manual write. */
export const USER_ACTOR: ActivityActor = { origin: 'user' };

export interface ActivityEntry {
  clientId: string;
  cycleId?: string | null;
  postId?: string | null;
  action: ActivityAction;
  actor: ActivityActor;
  payload?: Record<string, unknown> | null;
}

/**
 * Append one row to the plan_activity ledger. Pass a transaction to make the ledger
 * row atomic with the mutation it records. Never updates or deletes.
 */
export async function recordActivity(exec: Executor, entry: ActivityEntry): Promise<void> {
  await exec.insert(planActivity).values({
    clientId:      entry.clientId,
    cycleId:       entry.cycleId ?? null,
    postId:        entry.postId ?? null,
    origin:        entry.actor.origin,
    action:        entry.action,
    refProposalId: entry.actor.refProposalId ?? null,
    payload:       entry.payload ?? null,
  });
}
