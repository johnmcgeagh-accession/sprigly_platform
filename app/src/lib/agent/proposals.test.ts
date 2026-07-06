/**
 * proposals.test.ts — proposal lifecycle, apply idempotency, and client scoping.
 *
 * Mocks @sprigly/db + drizzle-orm so every write is an inspectable descriptor. The
 * key guarantees: pending→approved→applied inserts exactly one plan_inputs row; a
 * double-approve never double-inserts (the conditional status transition gates it);
 * and every query is scoped by clientId.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  planInputsInserts: [] as Record<string, unknown>[],
  proposalInserts: [] as Record<string, unknown>[],
  updateWheres: [] as unknown[],
  selectWheres: [] as unknown[],
  claimQueue: [] as unknown[][],
  currentRow: null as Record<string, unknown> | null,
  listRows: [] as Record<string, unknown>[],
  proposalInsertRow: { id: 'prop-1', intent: 'note_for_month', summary: 's', status: 'pending' } as Record<string, unknown>,
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  desc: (col: unknown) => ({ op: 'desc', col }),
}));

vi.mock('@sprigly/db', () => {
  const table = (name: string) => new Proxy({ __table: name }, { get: (_t, p) => (p === '__table' ? name : String(p)) });
  const agentProposals = table('agent_proposals');
  const planInputs = table('plan_inputs');
  const tname = (t: unknown) => (t as { __table?: string })?.__table ?? '';
  const db = {
    insert(t: unknown) {
      const name = tname(t);
      return {
        values(v: Record<string, unknown>) {
          if (name === 'plan_inputs') h.planInputsInserts.push(v);
          if (name === 'agent_proposals') h.proposalInserts.push(v);
          return {
            returning: () => Promise.resolve(name === 'agent_proposals' ? [h.proposalInsertRow] : []),
            onConflictDoNothing: () => Promise.resolve([]),
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where(cond: unknown) {
              h.updateWheres.push(cond);
              return Object.assign(Promise.resolve(), {
                returning: () => Promise.resolve(h.claimQueue.length ? h.claimQueue.shift()! : []),
              });
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where(cond: unknown) {
              h.selectWheres.push(cond);
              return {
                limit: () => Promise.resolve(h.currentRow ? [h.currentRow] : []),
                orderBy: () => Promise.resolve(h.listRows),
              };
            },
          };
        },
      };
    },
  };
  return { db, agentProposals, planInputs };
});

import { createProposal, listPendingProposals, approveProposal, rejectProposal } from './proposals';

interface EqDescriptor { op: string; col?: string; val?: unknown; parts?: EqDescriptor[] }
function collectEqs(cond: EqDescriptor | undefined): Array<{ col: string; val: unknown }> {
  if (!cond) return [];
  if (cond.op === 'eq') return [{ col: cond.col as string, val: cond.val }];
  if (cond.op === 'and') return (cond.parts ?? []).flatMap(collectEqs);
  return [];
}

const CLIENT = 'client-1';
const claimRow = {
  id: 'prop-1', clientId: CLIENT, intent: 'note_for_month', summary: 's', status: 'approved',
  payload: { type: 'note', content: 'The wool coat launches on the 14th.', cycleId: 'cycle-1' },
};

beforeEach(() => {
  h.planInputsInserts.length = 0;
  h.proposalInserts.length = 0;
  h.updateWheres.length = 0;
  h.selectWheres.length = 0;
  h.claimQueue.length = 0;
  h.currentRow = null;
  h.listRows = [];
});

describe('createProposal', () => {
  it('inserts a client-scoped pending proposal', async () => {
    const v = await createProposal({
      clientId: CLIENT, conversationId: 'conv-1', messageId: 'msg-1',
      intent: 'note_for_month', payload: { type: 'note', content: 'x', cycleId: null }, summary: 'Save note: x',
    });
    expect(v.status).toBe('pending');
    expect(h.proposalInserts[0]).toMatchObject({ clientId: CLIENT, intent: 'note_for_month' });
  });
});

describe('listPendingProposals', () => {
  it('is scoped by clientId and status=pending', async () => {
    h.listRows = [{ id: 'p1', intent: 'idea_backlog', summary: 's', status: 'pending' }];
    const out = await listPendingProposals(CLIENT);
    expect(out).toHaveLength(1);
    const eqs = collectEqs(h.selectWheres[0] as EqDescriptor);
    expect(eqs).toContainEqual({ col: 'clientId', val: CLIENT });
    expect(eqs).toContainEqual({ col: 'status', val: 'pending' });
  });
});

describe('approveProposal — lifecycle + idempotency', () => {
  it('pending → approved → applied inserts exactly one plan_inputs row', async () => {
    h.claimQueue = [[claimRow]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r?.status).toBe('applied');
    expect(h.planInputsInserts).toHaveLength(1);
    expect(h.planInputsInserts[0]).toMatchObject({
      clientId: CLIENT, cycleId: 'cycle-1', type: 'note',
      content: 'The wool coat launches on the 14th.', sourceProposalId: 'prop-1',
    });
  });

  it('the claim UPDATE is scoped by clientId AND guarded on status=pending', async () => {
    h.claimQueue = [[claimRow]];
    await approveProposal(CLIENT, 'prop-1', 'client');
    const eqs = collectEqs(h.updateWheres[0] as EqDescriptor);
    expect(eqs).toContainEqual({ col: 'clientId', val: CLIENT });
    expect(eqs).toContainEqual({ col: 'status', val: 'pending' });
    expect(eqs).toContainEqual({ col: 'id', val: 'prop-1' });
  });

  it('a double-approve does NOT double-insert', async () => {
    // First approve claims the row; second finds nothing pending (guard) → no apply.
    h.claimQueue = [[claimRow], []];
    h.currentRow = { id: 'prop-1', intent: 'note_for_month', summary: 's', status: 'applied' };
    const first = await approveProposal(CLIENT, 'prop-1', 'client');
    const second = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(first?.status).toBe('applied');
    expect(second?.status).toBe('applied'); // idempotent — returns current state
    expect(h.planInputsInserts).toHaveLength(1);
  });

  it('returns null when the proposal is neither claimable nor found', async () => {
    h.claimQueue = [[]];
    h.currentRow = null;
    const r = await approveProposal(CLIENT, 'missing', 'client');
    expect(r).toBeNull();
  });
});

describe('rejectProposal', () => {
  it('rejects a pending proposal, scoped + status-guarded', async () => {
    h.claimQueue = [[{ id: 'prop-1', intent: 'idea_backlog', summary: 's', status: 'rejected' }]];
    const r = await rejectProposal(CLIENT, 'prop-1', 'client');
    expect(r?.status).toBe('rejected');
    expect(h.planInputsInserts).toHaveLength(0);
    const eqs = collectEqs(h.updateWheres[0] as EqDescriptor);
    expect(eqs).toContainEqual({ col: 'clientId', val: CLIENT });
    expect(eqs).toContainEqual({ col: 'status', val: 'pending' });
  });
});
