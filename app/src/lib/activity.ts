/**
 * activity.ts — append-only writes to the plan_activity ledger (AUDIT.md §3).
 *
 * ONE ordered stream regardless of actor: manual edits record origin='user'; approved
 * agent proposals record origin='agent' + refProposalId. There is intentionally NO
 * update/delete helper — plan_activity is append-only, enforced in the DB by a trigger
 * (migration 0068). recordActivity accepts either the db handle or a transaction, so a
 * write + its ledger row commit atomically (see mutations.ts).
 */
import { db, planActivity, type PlanActor } from '@sprigly/db';

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
  | 'checklist_generated'
  /**
   * The client's brief for a month, saved pre-cutoff (POST /api/plan/intake).
   *
   * Named for the object saved, like every other write here — `caption_saved`, `hook_saved`,
   * `script_saved` — rather than for the act of submitting a form.
   *
   * It is the single most consequential thing a client does on this surface: the whole month is
   * generated from it, and it is the one write with no post_id, because it is about the month
   * and not about any row in it. It recorded nothing at all until now, so the ledger could
   * show thirty captions being edited and not the brief every one of them came from.
   */
  | 'brief_saved'
  // ── Draft-beat mutations (observability only) ───────────────────────────────
  // A draft drop is a HARD delete with no tombstone, and nothing recorded these at all —
  // so when six launch-arc beats vanished from cycle 040d6a1a before approval, the data
  // could not say what had removed them and the investigation had to infer it
  // (docs/reports/wrong-month-generated.md §6). These make the next such question
  // answerable. plan_activity.post_id carries NO foreign key (migration 0090), so the row survives the
  // beat it describes — which is the point.
  | 'beat_added'
  | 'beat_dropped'
  | 'beat_restored'
  | 'beat_moved'
  | 'beat_format_changed';

/**
 * Who caused a change, and (for agent changes) which proposal it applied.
 *
 * TWO fields, not one, and they answer DIFFERENT questions.
 *
 *   `origin` — who COMPOSED the write. 'user' | 'agent', shipped, unchanged, and what existing
 *              readers switch on.
 *   `actor`  — whose INTENT it carries: who wanted it, not who typed it (0090).
 *
 * They agree most of the time and come apart exactly where it matters. An approved agent
 * proposal is origin 'agent', actor 'client': the agent wrote the words, the client asked for
 * them. The approval fan-out's captions are origin 'agent', actor 'agent': nobody asked in the
 * moment; approving a draft is one act about a month, not a touch of each post in it.
 *
 * That distinction is the whole point. The untouched-post rate asks how much of a generated
 * month a client never engaged with, and origin alone cannot answer it — it would score a
 * client's own "make it warmer" and our nightly sweep identically.
 *
 * Widening `origin` to carry all this instead would have silently redefined every historical
 * row: a 2026-06 'user' row would have become "client or operator, unknown which" while still
 * looking like a definite answer.
 */
export interface ActivityActor {
  origin: ActivityOrigin;
  actor:  PlanActor;
  refProposalId?: string | null;
}

/**
 * The default attribution for a direct manual write in THIS app.
 *
 * Every write path in app/ is reached through a magic-link session — there is no other way in
 * (lib/auth.ts). So a manual write here is the client's own hand, and saying so is a fact
 * about the routing, not an assumption about the person.
 */
export const USER_ACTOR: ActivityActor = { origin: 'user', actor: 'client' };

/**
 * Us, editing on a client's behalf.
 *
 * Nothing in this repo produces it yet: admin does not write plan_activity or post_edits at
 * all today. It is defined here so the first operator edit surface lands on a named constant
 * rather than reaching for USER_ACTOR and quietly counting an operator's fix as a client
 * touch — which is the one way this measurement gets corrupted without anyone noticing.
 */
export const OPERATOR_ACTOR: ActivityActor = { origin: 'user', actor: 'operator' };

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
    actor:         entry.actor.actor,
    action:        entry.action,
    refProposalId: entry.actor.refProposalId ?? null,
    payload:       entry.payload ?? null,
  });
}
