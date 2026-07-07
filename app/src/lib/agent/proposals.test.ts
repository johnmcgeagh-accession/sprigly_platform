/**
 * proposals.test.ts — proposal lifecycle, deterministic apply, idempotency, scoping.
 *
 * Mocks the mutation/queue/usage collaborators and @sprigly/db + drizzle-orm so
 * every write is inspectable. Guarantees: approving a move/delete/add calls the
 * right mutation exactly once (client+cycle scoped); a rewrite enqueues a job; a
 * double-approve never re-applies; reject leaves data untouched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  updateWheres: [] as unknown[],
  selectWheres: [] as unknown[],
  claimQueue: [] as unknown[][],
  currentRow: null as Record<string, unknown> | null,
  listRows: [] as Record<string, unknown>[],
  proposalInsertRow: { id: 'prop-1', intent: 'move_post', summary: 's', status: 'pending', changeSetId: 'cs-1' } as Record<string, unknown>,
  patch: vi.fn(),
  softDelete: vi.fn(),
  add: vi.fn(),
  addGen: vi.fn(),
  addGenerating: vi.fn(),
  startGen: vi.fn(),
  markNote: vi.fn(),
  enqueue: vi.fn(),
  usage: { used: 0, limit: 30, unlimited: false } as Record<string, unknown>,
  blocked: false,
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  desc: (col: unknown) => ({ op: 'desc', col }),
}));

vi.mock('@sprigly/db', () => {
  const table = (name: string) => new Proxy({ __table: name }, { get: (_t, p) => (p === '__table' ? name : String(p)) });
  const agentProposals = table('agent_proposals');
  const contentCycles = table('content_cycles');
  const db = {
    update() {
      return { set() { return { where(cond: unknown) {
        h.updateWheres.push(cond);
        return Object.assign(Promise.resolve(), { returning: () => Promise.resolve(h.claimQueue.length ? h.claimQueue.shift()! : []) });
      } }; } };
    },
    select() {
      return { from() { return { where(cond: unknown) {
        h.selectWheres.push(cond);
        return { limit: () => Promise.resolve(h.currentRow ? [h.currentRow] : []), orderBy: () => Promise.resolve(h.listRows) };
      } }; } };
    },
    insert() { return { values() { return { returning: () => Promise.resolve([h.proposalInsertRow]) }; } }; },
  };
  return { db, agentProposals, contentCycles };
});

vi.mock('../mutations', () => ({
  patchPost: (...a: unknown[]) => h.patch(...a),
  softDeletePost: (...a: unknown[]) => h.softDelete(...a),
  addDraft: (...a: unknown[]) => h.add(...a),
  addGeneratedPost: (...a: unknown[]) => h.addGen(...a),
  addGeneratingPost: (...a: unknown[]) => h.addGenerating(...a),
}));
vi.mock('../post-generation', () => ({ startPostGeneration: (...a: unknown[]) => h.startGen(...a) }));
vi.mock('./notes', () => ({ markNoteIntegrated: (...a: unknown[]) => h.markNote(...a) }));
vi.mock('../queue', () => ({ enqueueShape: (...a: unknown[]) => h.enqueue(...a) }));
vi.mock('../usage', () => ({
  getUsageForCycle: async () => h.usage,
  isRewriteBlocked: () => h.blocked,
}));

import { createProposal, listPendingProposals, approveProposal, rejectProposal } from './proposals';

interface EqDescriptor { op: string; col?: string; val?: unknown; parts?: EqDescriptor[] }
function collectEqs(cond: EqDescriptor | undefined): Array<{ col: string; val: unknown }> {
  if (!cond) return [];
  if (cond.op === 'eq') return [{ col: cond.col as string, val: cond.val }];
  if (cond.op === 'and') return (cond.parts ?? []).flatMap(collectEqs);
  return [];
}

const CLIENT = 'client-1';
const moveRow = { id: 'prop-1', clientId: CLIENT, intent: 'move_post', summary: 's', status: 'approved', changeSetId: 'cs-1', payload: { kind: 'move', cycleId: 'cycle-1', postId: 'post-9', toDate: '2026-09-14' } };

beforeEach(() => {
  h.updateWheres.length = 0; h.selectWheres.length = 0; h.claimQueue.length = 0;
  h.currentRow = null; h.listRows = [];
  h.patch.mockReset(); h.softDelete.mockReset(); h.add.mockReset(); h.addGen.mockReset();
  h.addGenerating.mockReset().mockResolvedValue({ postId: 'post-new' });
  h.startGen.mockReset().mockResolvedValue({ jobId: 'shape_cycle-1_post-new' });
  h.markNote.mockReset(); h.enqueue.mockReset();
  h.blocked = false; h.usage = { used: 0, limit: 30, unlimited: false };
});

describe('createProposal', () => {
  it('inserts a proposal carrying the changeSetId', async () => {
    const v = await createProposal({
      clientId: CLIENT, conversationId: 'c', messageId: 'm', changeSetId: 'cs-1',
      action: 'move_post', payload: { kind: 'move', cycleId: 'cycle-1', postId: 'post-9', toDate: '2026-09-14' }, summary: 's',
    });
    expect(v.changeSetId).toBe('cs-1');
  });
});

describe('listPendingProposals', () => {
  it('is scoped by clientId and status=pending', async () => {
    h.listRows = [{ id: 'p1', intent: 'move_post', summary: 's', status: 'pending', changeSetId: 'cs-1' }];
    await listPendingProposals(CLIENT);
    const eqs = collectEqs(h.selectWheres[0] as EqDescriptor);
    expect(eqs).toContainEqual({ col: 'clientId', val: CLIENT });
    expect(eqs).toContainEqual({ col: 'status', val: 'pending' });
  });
});

describe('approve applies deterministically, scoped + idempotent', () => {
  it('a move approval calls patchPost once with (clientId, cycleId, postId, {date})', async () => {
    h.claimQueue = [[moveRow]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.patch).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-9', { date: '2026-09-14' }, { origin: 'agent', refProposalId: 'prop-1' });
  });

  it('the claim UPDATE is scoped by clientId AND guarded on status=pending', async () => {
    h.claimQueue = [[moveRow]];
    await approveProposal(CLIENT, 'prop-1', 'client');
    const eqs = collectEqs(h.updateWheres[0] as EqDescriptor);
    expect(eqs).toContainEqual({ col: 'clientId', val: CLIENT });
    expect(eqs).toContainEqual({ col: 'status', val: 'pending' });
    expect(eqs).toContainEqual({ col: 'id', val: 'prop-1' });
  });

  it('a delete approval calls softDeletePost once', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'delete_post', payload: { kind: 'delete', cycleId: 'cycle-1', postId: 'post-9' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.softDelete).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-9', { origin: 'agent', refProposalId: 'prop-1' });
  });

  it('a rewrite approval enqueues a shape job and returns its jobId', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'rewrite_post', payload: { kind: 'rewrite', cycleId: 'cycle-1', postId: 'post-9', instruction: 'make it warmer' } }]];
    h.enqueue.mockResolvedValue({ jobId: 'shape_cycle-1_post-9' });
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.jobId).toBe('shape_cycle-1_post-9');
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });

  it('a rewrite approval over the monthly limit fails without enqueuing', async () => {
    h.blocked = true;
    h.claimQueue = [[{ ...moveRow, intent: 'rewrite_post', payload: { kind: 'rewrite', cycleId: 'cycle-1', postId: 'post-9', instruction: 'x' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('failed');
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('a weekly-session apply_caption approval patches the caption deterministically and marks the note integrated', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'rewrite_post', payload: { kind: 'apply_caption', cycleId: 'cycle-1', postId: 'post-9', caption: 'New warmer caption', noteId: 'note-7' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.patch).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-9', { caption: 'New warmer caption' }, { origin: 'agent', refProposalId: 'prop-1' });
    expect(h.markNote).toHaveBeenCalledWith(CLIENT, 'note-7', 'prop-1');
    expect(h.enqueue).not.toHaveBeenCalled();   // pre-generated — no second generation
  });

  it('an apply_caption with no noteId does not touch notes', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'rewrite_post', payload: { kind: 'apply_caption', cycleId: 'cycle-1', postId: 'post-9', caption: 'x', noteId: null } }]];
    await approveProposal(CLIENT, 'prop-1', 'client');
    expect(h.markNote).not.toHaveBeenCalled();
  });

  it('a weekly-session add_generated approval inserts the pre-generated draft', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'add_post', payload: { kind: 'add_generated', cycleId: 'cycle-1', date: '2026-07-15', channel: 'instagram', format: 'single', pillar: 'Weather', caption: 'Heatwave edit' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.addGen).toHaveBeenCalledWith(CLIENT, 'cycle-1', { channel: 'instagram', date: '2026-07-15', format: 'single', pillar: 'Weather', caption: 'Heatwave edit' }, { origin: 'agent', refProposalId: 'prop-1' });
  });

  it('an add_post WITH an instruction inserts the post and enqueues generation (jobId returned)', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'add_post', payload: { kind: 'add', cycleId: 'cycle-1', date: '2026-07-15', channel: 'instagram', instruction: 'a post about the linen restock' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.addGenerating).toHaveBeenCalledWith(CLIENT, 'cycle-1', { channel: 'instagram', date: '2026-07-15', instruction: 'a post about the linen restock' }, { origin: 'agent', refProposalId: 'prop-1' });
    expect(h.startGen).toHaveBeenCalledTimes(1);
    expect(h.startGen).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-new', 'a post about the linen restock');
    expect(r.jobId).toBe('shape_cycle-1_post-new');
    expect(h.add).not.toHaveBeenCalled();   // not the blank-draft path
  });

  it('a BARE add_post (no instruction) inserts a blank draft, no generation', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'add_post', payload: { kind: 'add', cycleId: 'cycle-1', date: '2026-07-15', channel: 'instagram' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.add).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'instagram', '2026-07-15', { origin: 'agent', refProposalId: 'prop-1' });
    expect(h.addGenerating).not.toHaveBeenCalled();
    expect(h.startGen).not.toHaveBeenCalled();
    expect(r.jobId).toBeUndefined();
  });

  it('a double-approve of an add-with-instruction inserts + enqueues ONCE (status guard)', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'add_post', payload: { kind: 'add', cycleId: 'cycle-1', date: '2026-07-15', channel: 'instagram', instruction: 'x' } }], []];
    h.currentRow = { id: 'prop-1', intent: 'add_post', summary: 's', status: 'applied', changeSetId: 'cs-1' };
    await approveProposal(CLIENT, 'prop-1', 'client');
    await approveProposal(CLIENT, 'prop-1', 'client');
    expect(h.addGenerating).toHaveBeenCalledTimes(1);
    expect(h.startGen).toHaveBeenCalledTimes(1);
  });

  it('a double-approve does NOT re-apply (status guard)', async () => {
    h.claimQueue = [[moveRow], []]; // second claim finds nothing pending
    h.currentRow = { id: 'prop-1', intent: 'move_post', summary: 's', status: 'applied', changeSetId: 'cs-1' };
    const first = await approveProposal(CLIENT, 'prop-1', 'client');
    const second = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(first.proposal?.status).toBe('applied');
    expect(second.proposal?.status).toBe('applied');
    expect(h.patch).toHaveBeenCalledTimes(1);
  });
});

describe('rejectProposal', () => {
  it('rejects a pending proposal without applying anything', async () => {
    h.claimQueue = [[{ id: 'prop-1', intent: 'move_post', summary: 's', status: 'rejected', changeSetId: 'cs-1' }]];
    const r = await rejectProposal(CLIENT, 'prop-1', 'client');
    expect(r?.status).toBe('rejected');
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.softDelete).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});
