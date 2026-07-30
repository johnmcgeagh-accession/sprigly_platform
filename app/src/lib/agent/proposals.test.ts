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
  followOn: vi.fn(),
  markNote: vi.fn(),
  enqueue: vi.fn(),
  enqueueHook: vi.fn(),
  usage: { used: 0, limit: 30, unlimited: false } as Record<string, unknown>,
  blocked: false,
  // DATE POLICY: default the affected post to far-future (editable); a test can override
  // to a past date to assert the agent read-only refusal.
  resolvePost: vi.fn(async () => ({ cycleId: 'cycle-1', scheduledDate: '2999-01-01', channel: 'instagram' }) as { cycleId: string; scheduledDate: string; channel: string } | null),
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
  const contentCyclePosts = table('content_cycle_posts');
  const planActivity = table('plan_activity');
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
  return { db, agentProposals, contentCycles, contentCyclePosts, planActivity };
});

vi.mock('../mutations', () => ({
  patchPost: (...a: unknown[]) => h.patch(...a),
  softDeletePost: (...a: unknown[]) => h.softDelete(...a),
  addDraft: (...a: unknown[]) => h.add(...a),
  addGeneratedPost: (...a: unknown[]) => h.addGen(...a),
  addGeneratingPost: (...a: unknown[]) => h.addGenerating(...a),
}));
vi.mock('../post-generation', () => ({
  startPostGeneration: (...a: unknown[]) => h.startGen(...a),
  enqueueFollowOnGeneration: (...a: unknown[]) => h.followOn(...a),
}));
vi.mock('./notes', () => ({ markNoteIntegrated: (...a: unknown[]) => h.markNote(...a) }));
vi.mock('../queue', () => ({ enqueueShape: (...a: unknown[]) => h.enqueue(...a), enqueueHookJob: (...a: unknown[]) => h.enqueueHook(...a) }));
vi.mock('../usage', () => ({
  getUsageForCycle: async () => h.usage,
  isRewriteBlocked: () => h.blocked,
}));
// DATE POLICY: keep the real rule (both-ends move / boundary), but resolve the post's
// date via the harness so tests control past/future without a DB.
vi.mock('../edit-scope', () => ({
  editScopeToday: () => '2026-07-11',
  isEditableDate: (d: string, t = '2026-07-11') => d >= t,
  canAddPost: (d: string | undefined, t = '2026-07-11') => !!d && d >= t,
  resolvePostForEdit: (...a: unknown[]) => h.resolvePost(...(a as [])),
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
  h.followOn.mockReset().mockResolvedValue(undefined);
  h.markNote.mockReset(); h.enqueue.mockReset();
  h.enqueueHook.mockReset().mockResolvedValue({ jobId: 'hook_cycle-1_post-9' });
  h.blocked = false; h.usage = { used: 0, limit: 30, unlimited: false };
  h.resolvePost.mockReset().mockResolvedValue({ cycleId: 'cycle-1', scheduledDate: '2999-01-01', channel: 'instagram' });
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
    expect(h.patch).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-9', { date: '2026-09-14' }, { origin: 'agent', actor: 'client', refProposalId: 'prop-1' }, '2026-07-11');
  });

  it('DATE POLICY: a move onto a PAST-dated post is refused (failed, patchPost never called)', async () => {
    h.resolvePost.mockResolvedValue({ cycleId: 'cycle-1', scheduledDate: '2026-06-01', channel: 'instagram' }); // past
    h.claimQueue = [[moveRow]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('failed');
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('DATE POLICY: a move whose toDate lands in the past is refused (both-ends rule)', async () => {
    // Post itself is future (editable) but the destination is before today.
    h.claimQueue = [[{ ...moveRow, payload: { kind: 'move', cycleId: 'cycle-1', postId: 'post-9', toDate: '2026-06-01' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('failed');
    expect(h.patch).not.toHaveBeenCalled();
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
    expect(h.softDelete).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-9', { origin: 'agent', actor: 'client', refProposalId: 'prop-1' }, '2026-07-11');
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
    expect(h.patch).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-9', { caption: 'New warmer caption' }, { origin: 'agent', actor: 'client', refProposalId: 'prop-1' }, '2026-07-11');
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
    expect(h.addGen).toHaveBeenCalledWith(CLIENT, 'cycle-1', { channel: 'instagram', date: '2026-07-15', format: 'single', pillar: 'Weather', caption: 'Heatwave edit' }, { origin: 'agent', actor: 'client', refProposalId: 'prop-1' }, '2026-07-11');
  });

  it('an add_post WITH an instruction inserts the post and enqueues generation (jobId returned)', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'add_post', payload: { kind: 'add', cycleId: 'cycle-1', date: '2026-07-15', channel: 'instagram', instruction: 'a post about the linen restock' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.addGenerating).toHaveBeenCalledWith(CLIENT, 'cycle-1', { channel: 'instagram', date: '2026-07-15', instruction: 'a post about the linen restock', format: 'single' }, { origin: 'agent', actor: 'client', refProposalId: 'prop-1' }, '2026-07-11');
    expect(h.startGen).toHaveBeenCalledTimes(1);
    expect(h.startGen).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-new', 'a post about the linen restock', '2026-07-11');
    expect(r.jobId).toBe('shape_cycle-1_post-new');
    expect(h.add).not.toHaveBeenCalled();   // not the blank-draft path
  });

  /**
   * ── F5: the full generation — the fixture ─────────────────────────────────────────
   *
   * An added CAROUSEL is owed its hook, and no path enqueued one (only the phase-2 fan-out
   * did). An added REEL is owed a coherent {hook, script} — which is ONE combined job whose
   * input is the caption, so it is deliberately NOT enqueued here: the worker enqueues it
   * the moment the caption lands (consumer.ts → enqueueScriptIfReady), a chain the fan-out
   * integration tests already pin. What this fixture asserts is the split.
   */
  it('F5: an agent-added CAROUSEL enqueues its hook alongside the caption', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'add_post', payload: { kind: 'add', cycleId: 'cycle-1', date: '2026-07-15', channel: 'instagram', instruction: 'five ways to style the linen dress', format: 'carousel' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.startGen).toHaveBeenCalledTimes(1);                                   // the caption
    expect(h.followOn).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-new', 'carousel');
  });

  it('F5: an agent-added REEL passes through the follow-on seam — the combined hook+script is the worker’s, on caption completion', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'add_post', payload: { kind: 'add', cycleId: 'cycle-1', date: '2026-07-15', channel: 'instagram', instruction: 'the heatwave', format: 'reel' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.followOn).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'post-new', 'reel');
    // No standalone hook job for a reel — its hook arrives WITH its script or not at all.
    expect(h.enqueueHook).not.toHaveBeenCalled();
  });

  it('a BARE add_post (no instruction) inserts a blank draft, no generation', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'add_post', payload: { kind: 'add', cycleId: 'cycle-1', date: '2026-07-15', channel: 'instagram' } }]];
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.add).toHaveBeenCalledWith(CLIENT, 'cycle-1', 'instagram', '2026-07-15', { origin: 'agent', actor: 'client', refProposalId: 'prop-1' }, 'single', '2026-07-11');
    expect(h.addGenerating).not.toHaveBeenCalled();
    expect(h.startGen).not.toHaveBeenCalled();
    expect(r.jobId).toBeUndefined();
  });

  it('a generate_hook for an existing reel enqueues the hook job and returns the target post', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'generate_hook', payload: { kind: 'generate_hook', cycleId: 'cycle-1', postId: 'post-9' } }]];
    h.currentRow = { format: 'reel', deletedAt: null };   // resolveHookTarget's post lookup
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.enqueueHook).toHaveBeenCalledWith({ type: 'hook', clientId: CLIENT, cycleId: 'cycle-1', targetPostId: 'post-9' });
    expect(r.hookPostId).toBe('post-9');
    expect(r.jobId).toBe('hook_cycle-1_post-9');
  });

  it('a generate_hook for a single-image post does NOT enqueue and stays approvable (blocked)', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'generate_hook', payload: { kind: 'generate_hook', cycleId: 'cycle-1', postId: 'post-9' } }]];
    h.currentRow = { format: 'single', deletedAt: null };
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.blocked).toBe(true);
    expect(r.proposal?.status).toBe('pending');
    expect(h.enqueueHook).not.toHaveBeenCalled();
  });

  it('a refine approval enqueues the target-aware shape job for the field', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'refine', payload: { kind: 'refine', cycleId: 'cycle-1', postId: 'post-9', target: 'script', instruction: 'punchier' } }]];
    h.currentRow = { format: 'reel', hook: 'h', script: 'a script', deletedAt: null };   // resolveRefineTarget lookup
    h.enqueue.mockResolvedValue({ jobId: 'shape_cycle-1_post-9' });
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.proposal?.status).toBe('applied');
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'shape', targetPostId: 'post-9', target: 'script', instruction: 'punchier', proposalId: 'prop-1' }));
    expect(r.jobId).toBe('shape_cycle-1_post-9');
  });

  it('a refine of an EMPTY field does NOT enqueue and stays approvable (blocked)', async () => {
    h.claimQueue = [[{ ...moveRow, intent: 'refine', payload: { kind: 'refine', cycleId: 'cycle-1', postId: 'post-9', target: 'script', instruction: 'punchier' } }]];
    h.currentRow = { format: 'reel', hook: 'h', script: null, deletedAt: null };   // no script → offer generation
    const r = await approveProposal(CLIENT, 'prop-1', 'client');
    expect(r.blocked).toBe(true);
    expect(r.proposal?.status).toBe('pending');
    expect(h.enqueue).not.toHaveBeenCalled();
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
