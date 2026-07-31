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

const POST3 = { id: 'post-3', cycleId: 'cycle-1', clientId: 'client-1', channel: 'instagram', date: '2026-09-03', format: 'reel', pillar: 'Autumn', caption: 'Autumn layers', status: 'planned', reviewState: null };

const h = vi.hoisted(() => ({
  session: { clientId: 'client-1', cycleId: 'cycle-1' } as { clientId: string; cycleId: string } | null,
  tasks: [] as ParsedTask[],
  posts: [] as Array<Record<string, unknown>>,
  /** Which cycle ids this client actually owns — the viewed cycle is verified, not trusted. */
  clientCycles: ['cycle-1', 'cycle-aug'] as string[],
  turnCalls: [] as string[],
  createCalls: [] as Array<Record<string, unknown>>,
  saveNote: vi.fn(),
  answerQuery: vi.fn(),
}));

// The turn reaches the date rule in `edit-scope`, which imports the db client for its OTHER
// exports; the rule itself is pure. Every collaborator that touches Postgres is mocked below —
// this stands in for the module-scope DATABASE_URL parse.
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
// The span (X1a) loads a post list per cycle, so this answers per cycle: the seeded posts
// belong to cycle-1 and nothing else invents rows the fixtures would then see twice.
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async (_c: string, cycleId: string) => (cycleId === 'cycle-1' ? h.posts : []) }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}), AGENT_MODEL: 'haiku' }));
vi.mock('@/lib/agent/task-parser', () => ({ parseTasks: async () => h.tasks }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => ({}) }));
// The REAL cycle-state over fixture rows: `plan-context.ts` builds the span from
// `listClientCycles`, so a wholesale stub would have to re-implement half the module.
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('@/lib/agent/cycle-state')>();
  const ROWS = [
    { id: 'cycle-1',   month: '2026-08', status: 'scheduled' },       // plans SEPTEMBER (the seed post's month)
    { id: 'cycle-aug', month: '2026-07', status: 'workbook_built' },  // plans AUGUST
  ];
  return {
    ...real,
    listClientCycles: async () => ROWS,
    getClientCycleMonths: async () => 'months',
    cycleBelongsToClient: async (_c: string, id: string) => h.clientCycles.includes(id),
  };
});
vi.mock('@/lib/agent/conversation', () => ({
  // Records the cycle the TURN actually ran against — the only place the route's scoping choice
  // is observable from outside.
  ensureConversation: async (_clientId: string, cycleId: string) => { h.turnCalls.push(cycleId); return 'conv-1'; },
  appendMessage: async () => 'msg-1',
}));
vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => {
    h.createCalls.push(args);
    return { id: `pv-${h.createCalls.length}`, intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId };
  },
  // C3: nothing pending in this harness.
  loadPendingPayloads: async () => [],
  rejectProposal: async () => null,
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: (...a: unknown[]) => h.saveNote(...a) }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: (...a: unknown[]) => h.answerQuery(...a) }));

import { POST } from './route';
import { resetRateLimit } from '@/lib/rate-limit';

const post = (body: unknown) => POST(new Request('http://x/api/plan/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  // The route's token bucket holds 8 and the file has more tests than that — without this the
  // later ones 429 and the failure looks like a scoping bug.
  resetRateLimit();
  h.session = { clientId: 'client-1', cycleId: 'cycle-1' };
  h.tasks = [];
  h.posts = [{ ...POST3 }];
  h.clientCycles = ['cycle-1', 'cycle-aug'];
  h.turnCalls.length = 0;
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

describe('move between two in-month dates (agent scoping + resolution fix)', () => {
  it('a date-named source → a move PROPOSAL even when the model mis-copied the id (resolves via fromDate)', async () => {
    // Simulates the real failure: the model set a WRONG postId but named the source date. Resolution
    // falls back to fromDate → the Aug/Sep-3 post → a move proposal, not a "which post?" clarify.
    h.tasks = [{ action: 'move_post', postId: 'garbled-uuid', selector: 'the post on the 3rd', fromDate: '2026-09-03', toDate: '2026-09-22', reason: 'move the post on the 3rd to the 22nd' }];
    const res = await post({ instruction: 'move the post on the 3rd of september to the 22nd' });
    const body = await res.json();
    expect(body.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.action).toBe('move_post');
    expect(h.createCalls[0]!.payload).toMatchObject({ kind: 'move', postId: 'post-3', toDate: '2026-09-22' });
    expect(body.message.toLowerCase()).not.toContain('couldn’t tell');   // never a blind not-found
  });

  it('multiple posts on the named date → a clarify that LISTS the candidates + acknowledges the destination', async () => {
    h.posts = [{ ...POST3 }, { ...POST3, id: 'post-3b', caption: 'The boxes have arrived' }];   // two on 2026-09-03
    h.tasks = [{ action: 'move_post', fromDate: '2026-09-03', selector: 'the post on the 3rd', toDate: '2026-09-22', reason: 'move the 3rd to the 22nd' }];
    const res = await post({ instruction: 'move the post on the 3rd to the 22nd' });
    const body = await res.json();
    expect(body.proposals).toHaveLength(0);                          // ambiguous → no proposal
    expect(body.message).toContain('There are 2 posts on 3 September');
    expect(body.message).toContain('Autumn layers');                // lists candidate 1
    expect(body.message).toContain('The boxes have arrived');       // lists candidate 2
    expect(body.message).toContain('to 22 September');              // acknowledges the destination
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
    // DELIBERATE CHANGE (X1b). The target month resolves through the turn's own month→cycle
    // lookup, which now answers from the span before it reaches the database. September's cycle
    // IS cycle-1, so that is where the note lands; the old 'cycle-x' was a stub id no real
    // resolution could ever have produced.
    expect(h.saveNote.mock.calls[0]![0]).toMatchObject({ clientId: 'client-1', cycleId: 'cycle-1', content: 'Launch the wool coat on the 14th.' });
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

describe('the viewed cycle, not the link’s cycle', () => {
  it('runs the turn against the month ON SCREEN when the body names one', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }];
    await post({ instruction: 'move the 5th to the 7th', cycleId: 'cycle-aug' });
    expect(h.turnCalls).toEqual(['cycle-aug']);
  });

  it('falls back to the session’s cycle when the body names none', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }];
    await post({ instruction: 'anything' });
    expect(h.turnCalls).toEqual(['cycle-1']);
  });

  it('IGNORES a cycle that is not this client’s — the body is checked, not trusted', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }];
    await post({ instruction: 'anything', cycleId: 'cycle-someone-else' });
    expect(h.turnCalls).toEqual(['cycle-1']);          // silently scoped back, never leaked
  });
});
