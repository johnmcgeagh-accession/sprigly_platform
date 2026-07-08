/**
 * ledger.ts — worker-side plan_activity writes (deviation-3 closure).
 *
 * The app writes plan_activity via app/src/lib/activity.ts, but the engine worker path
 * (shape caption rewrite, script generation) never emitted its rows — so agent-authored
 * content was missing from the ledger. This helper mirrors recordActivity for the worker:
 * one INSERT (plan_activity is append-only; UPDATE/DELETE are blocked by the 0068 trigger),
 * origin 'agent' + ref_proposal_id when the change applied an approved proposal.
 */
import { db as _db, planActivity } from '@sprigly/db';

type Db = typeof _db;

export interface WorkerActor { origin: 'user' | 'agent'; refProposalId?: string | null }

export interface WorkerActivityEntry {
  clientId: string;
  cycleId?: string | null;
  postId?: string | null;
  action: 'caption_saved' | 'script_saved' | (string & {});
  actor: WorkerActor;
  payload?: Record<string, unknown> | null;
}

/** Append one plan_activity row from the worker. */
export async function recordPlanActivity(db: Db, entry: WorkerActivityEntry): Promise<void> {
  await db.insert(planActivity).values({
    clientId:      entry.clientId,
    cycleId:       entry.cycleId ?? null,
    postId:        entry.postId ?? null,
    origin:        entry.actor.origin,
    action:        entry.action,
    refProposalId: entry.actor.refProposalId ?? null,
    payload:       entry.payload ?? null,
  });
}
