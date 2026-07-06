/**
 * agent/proposals.ts — proposal lifecycle + deterministic apply.
 *
 * Capture intents (note/idea/next_cycle) create a pending agent_proposals row and
 * touch NO content table. Approval applies the proposal by INSERTing a plan_inputs
 * row from the stored payload — pure and deterministic, no model. Apply is
 * idempotent two ways: a conditional status transition (only 'pending' → 'approved'
 * proceeds) and a unique index on plan_inputs.source_proposal_id, so a
 * double-approve can never double-insert. Everything is client-scoped.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, agentProposals, planInputs } from '@sprigly/db';
import type { AgentProposalRow } from '@sprigly/db';
import type { CaptureIntent, ProposalPayload, ProposalView } from './types';

const view = (r: Pick<AgentProposalRow, 'id' | 'intent' | 'summary' | 'status'>): ProposalView =>
  ({ id: r.id, intent: r.intent, summary: r.summary, status: r.status });

export interface CreateProposalArgs {
  clientId: string;
  conversationId: string;
  messageId: string;
  intent: CaptureIntent;
  payload: ProposalPayload;
  summary: string;
}

export async function createProposal(args: CreateProposalArgs): Promise<ProposalView> {
  const [row] = await db
    .insert(agentProposals)
    .values({
      clientId: args.clientId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      intent: args.intent,
      payload: args.payload as unknown as Record<string, unknown>,
      summary: args.summary,
    })
    .returning({ id: agentProposals.id, intent: agentProposals.intent, summary: agentProposals.summary, status: agentProposals.status });
  return view(row!);
}

/** Pending proposals for a client, newest first. Client-scoped. */
export async function listPendingProposals(clientId: string): Promise<ProposalView[]> {
  const rows = await db
    .select({ id: agentProposals.id, intent: agentProposals.intent, summary: agentProposals.summary, status: agentProposals.status })
    .from(agentProposals)
    .where(and(eq(agentProposals.clientId, clientId), eq(agentProposals.status, 'pending')))
    .orderBy(desc(agentProposals.createdAt));
  return rows.map(view);
}

async function currentView(clientId: string, id: string): Promise<ProposalView | null> {
  const [row] = await db
    .select({ id: agentProposals.id, intent: agentProposals.intent, summary: agentProposals.summary, status: agentProposals.status })
    .from(agentProposals)
    .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)))
    .limit(1);
  return row ? view(row) : null;
}

/** Deterministic apply: one plan_inputs row from the proposal payload. The
 *  onConflictDoNothing on source_proposal_id is the DB-level idempotency backstop. */
async function applyProposal(row: AgentProposalRow): Promise<void> {
  const payload = row.payload as unknown as ProposalPayload;
  await db
    .insert(planInputs)
    .values({
      clientId: row.clientId,
      cycleId: payload.cycleId ?? null,
      type: payload.type,
      content: payload.content,
      sourceProposalId: row.id,
    })
    .onConflictDoNothing({ target: planInputs.sourceProposalId });
}

/**
 * Approve + apply a proposal, idempotently. The conditional transition
 * (WHERE status='pending') is the concurrency gate — only one caller applies.
 * A second approve (already applied/rejected) is a no-op returning current state.
 */
export async function approveProposal(clientId: string, id: string, resolvedBy: string): Promise<ProposalView | null> {
  const claimed = await db
    .update(agentProposals)
    .set({ status: 'approved', resolvedAt: new Date(), resolvedBy })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId), eq(agentProposals.status, 'pending')))
    .returning();
  const row = claimed[0];
  if (!row) return currentView(clientId, id); // not pending (already resolved) or not owned

  try {
    await applyProposal(row);
    await db
      .update(agentProposals)
      .set({ status: 'applied', appliedAt: new Date() })
      .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)));
    return view({ ...row, status: 'applied' });
  } catch (err) {
    await db
      .update(agentProposals)
      .set({ status: 'failed', error: String(err) })
      .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)));
    return view({ ...row, status: 'failed' });
  }
}

/** Reject a pending proposal. Idempotent — a non-pending proposal returns current. */
export async function rejectProposal(clientId: string, id: string, resolvedBy: string): Promise<ProposalView | null> {
  const rejected = await db
    .update(agentProposals)
    .set({ status: 'rejected', resolvedAt: new Date(), resolvedBy })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId), eq(agentProposals.status, 'pending')))
    .returning({ id: agentProposals.id, intent: agentProposals.intent, summary: agentProposals.summary, status: agentProposals.status });
  const row = rejected[0];
  if (row) return view(row);
  return currentView(clientId, id);
}
