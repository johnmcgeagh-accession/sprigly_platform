/**
 * agent-route.test.ts — orchestration behaviour of POST /api/plan/agent.
 *
 * Mocks the parser + collaborators and asserts: a compound message creates one
 * change set of proposals plus inline answers with NOTHING applied on the turn; a
 * single mutating task creates a proposal (not an apply); an ambiguous task
 * clarifies while its siblings proceed; add_note writes a note (no proposal); and
 * garbage yields a clarify reply with no error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from '@/lib/agent/types';

const h = vi.hoisted(() => ({
  session: { clientId: 'client-1', cycleId: 'cycle-1' } as { clientId: string; cycleId: string } | null,
  tasks: [] as ParsedTask[],
  createCalls: [] as Array<Record<string, unknown>>,
  saveNote: vi.fn(),
  answerQuery: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/plan', () => ({
  loadPlanPosts: async () => [
    { id: 'post-3', cycleId: 'cycle-1', clientId: 'client-1', channel: 'instagram', date: '2026-09-03', format: 'reel', pillar: 'Autumn', caption: 'Autumn layers', status: 'planned', reviewState: null },
  ],
}));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}), AGENT_MODEL: 'haiku' }));
vi.mock('@/lib/agent/task-parser', () => ({ parseTasks: async () => h.tasks }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => ({}) }));
vi.mock('@/lib/agent/cycle-state', () => ({
  getClientCycleMonths: async () => 'months', cycleDigest: () => 'digest', resolveCycleForMonth: async () => 'cycle-x',
  getCycleMonth: async () => '2026-09',   // the seed post is 2026-09-03; same-month moves proceed
}));
vi.mock('@/lib/agent/conversation', () => ({
  ensureConversation: async () => 'conv-1',
  appendMessage: async () => 'msg-1',
}));
vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => {
    h.createCalls.push(args);
    return { id: `pv-${h.createCalls.length}`, intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId };
  },
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: (...a: unknown[]) => h.saveNote(...a) }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: (...a: unknown[]) => h.answerQuery(...a) }));

import { POST } from './route';

const post = (body: unknown) => POST(new Request('http://x/api/plan/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  h.session = { clientId: 'client-1', cycleId: 'cycle-1' };
  h.tasks = [];
  h.createCalls.length = 0;
  h.saveNote.mockReset();
  h.answerQuery.mockReset().mockResolvedValue('You need to film the reel.');
});

describe('compound message', () => {
  it('creates one change set of proposals + an inline answer, nothing applied', async () => {
    h.tasks = [
      { action: 'move_post', postId: 'post-3', toDate: '2026-09-05', reason: 'move the reel to Saturday' },
      { action: 'add_post', toDate: '2026-09-10', reason: 'add a post for the drop' },
      { action: 'query', question: 'What do I need to film this week?' },
    ];
    const res = await post({ instruction: 'move the reel to sat, add a post for the drop, and what do i film this week' });
    const body = await res.json();

    expect(body.proposals).toHaveLength(2);                 // move + add
    expect(h.createCalls).toHaveLength(2);
    expect(h.answerQuery).toHaveBeenCalledTimes(1);
    // Both proposals share ONE change set.
    expect(body.changeSetId).toBeTruthy();
    expect(new Set(h.createCalls.map((c) => c.changeSetId)).size).toBe(1);
    expect(body.proposals.every((p: { changeSetId: string }) => p.changeSetId === body.changeSetId)).toBe(true);
    // The answer is in the reply; no note was written.
    expect(body.message).toContain('film');
    expect(h.saveNote).not.toHaveBeenCalled();
  });
});

describe('single mutating task', () => {
  it('"move post 3 to Friday" creates a proposal — it is NOT applied on the turn', async () => {
    h.tasks = [{ action: 'move_post', postId: 'post-3', toDate: '2026-09-05', reason: 'move post 3 to Friday' }];
    const res = await post({ instruction: 'move post 3 to friday' });
    const body = await res.json();
    expect(body.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.payload).toMatchObject({ kind: 'move', cycleId: 'cycle-1', postId: 'post-3', toDate: '2026-09-05' });
    // The route only proposes — no note, no apply side effects here.
    expect(h.saveNote).not.toHaveBeenCalled();
  });
});

describe('move between two in-month dates (agent scoping fix)', () => {
  it('a post on the source date → a move PROPOSAL, never a not-found — even off the current week', async () => {
    // The source post (2026-09-03) is not in "this week"; with the full-cycle digest the parser
    // resolves it, and the turn proposes the move to another in-month date rather than replying
    // that there are no posts.
    h.tasks = [{ action: 'move_post', postId: 'post-3', toDate: '2026-09-22', reason: 'move the post from the 3rd to the 22nd' }];
    const res = await post({ instruction: 'move the post from the 3rd of september to the 22nd' });
    const body = await res.json();
    expect(body.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.action).toBe('move_post');
    expect(h.createCalls[0]!.payload).toMatchObject({ kind: 'move', postId: 'post-3', toDate: '2026-09-22' });
    expect(body.message.toLowerCase()).not.toContain('no posts');   // never a not-found
    expect(body.message.toLowerCase()).not.toContain('this week');   // never week-scoped language
  });
});

describe('ambiguous task in a compound message', () => {
  it('clarifies that task while a sibling note still saves', async () => {
    h.tasks = [
      { action: 'clarify', question: 'Which reel did you mean?', reason: 'make the reel warmer' },
      { action: 'add_note', content: 'Sale ends the 20th.', reason: 'note the sale' },
    ];
    const res = await post({ instruction: 'make the reel warmer and note the sale ends the 20th' });
    const body = await res.json();
    expect(body.message).toContain('Which reel');
    expect(h.saveNote).toHaveBeenCalledTimes(1);   // sibling unaffected
    expect(h.createCalls).toHaveLength(0);         // clarify creates no proposal
    expect(body.proposals).toHaveLength(0);
    expect(body.changeSetId).toBeNull();
  });
});

describe('add_note', () => {
  it('writes a note directly, with no proposal', async () => {
    h.tasks = [{ action: 'add_note', content: 'Launch the wool coat on the 14th.', targetMonth: '2026-09', reason: 'remember the launch' }];
    const res = await post({ instruction: 'remember we launch the wool coat on the 14th' });
    const body = await res.json();
    expect(h.saveNote).toHaveBeenCalledTimes(1);
    expect(h.saveNote.mock.calls[0]![0]).toMatchObject({ clientId: 'client-1', cycleId: 'cycle-x', content: 'Launch the wool coat on the 14th.' });
    expect(body.proposals).toHaveLength(0);
  });
});

describe('resilience', () => {
  it('a clarify-only parse returns a clarify reply with no proposals and no error', async () => {
    h.tasks = [{ action: 'clarify', question: 'Could you rephrase that?' }];
    const res = await post({ instruction: 'asdkjhasd' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Could you rephrase that?');
    expect(h.createCalls).toHaveLength(0);
  });

  it('401 without a session', async () => {
    h.session = null;
    const res = await post({ instruction: 'anything' });
    expect(res.status).toBe(401);
  });
});
