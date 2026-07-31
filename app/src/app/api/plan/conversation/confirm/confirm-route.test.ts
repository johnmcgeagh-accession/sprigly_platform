/**
 * confirm-route.test.ts — the apply's report, written back as a turn, and the rescue it seeds.
 *
 * Two things ride on this route. The confirmation sentence stops living only in React state
 * (carried open since round 1 — a remount inside a session lost it). And a REFUSED change is
 * written back as a PENDING INTENT, which is what turns "Tell me another date and I'll put it
 * in" from a promise into a mechanism: the proposal is consumed by the guard, so without the
 * intent the next utterance — "the 30th then" — has no referent anywhere.
 *
 * What the client may say is the TEXT and WHICH PROPOSALS. Never the intent: it goes into the
 * next turn's prompt, and a client-supplied one would be a way to write straight into it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: { clientId: 'c1', cycleId: 'cyc-1' } as { clientId: string; cycleId: string } | null,
  ownedRows: [{ id: 'conv-1' }] as Array<{ id: string }>,
  appended: [] as Array<Record<string, unknown>>,
  proposal: null as Record<string, unknown> | null,
}));

vi.mock('drizzle-orm', () => ({
  and: (...p: unknown[]) => ({ op: 'and', p }),
  eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }),
}));
vi.mock('@sprigly/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => h.ownedRows }) }) }) },
  conversations: {},
}));
vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/agent/conversation', () => ({
  appendMessage: async (a: Record<string, unknown>) => { h.appended.push(a); return 'msg-1'; },
}));
vi.mock('@/lib/agent/proposals', () => ({
  loadProposalPayload: async () => h.proposal,
}));

import { POST } from './route';

const call = (body: unknown) =>
  POST(new Request('http://x/api/plan/conversation/confirm', { method: 'POST', body: JSON.stringify(body) }));

const lastMeta = () => h.appended[h.appended.length - 1]?.['metadata'] as Record<string, unknown>;

const REFUSED_ADD = {
  intent: 'add_post', summary: 'Add a reel on 31 October', status: 'failed',
  payload: { kind: 'add', cycleId: 'cyc-1', date: '2026-10-31', channel: 'instagram', instruction: 'The raspberry launch', format: 'reel' },
};

beforeEach(() => {
  h.session = { clientId: 'c1', cycleId: 'cyc-1' };
  h.ownedRows = [{ id: 'conv-1' }];
  h.appended.length = 0;
  h.proposal = null;
});

describe('the confirmation is persisted as an assistant turn', () => {
  it('a clean apply writes the sentence and nothing else', async () => {
    const res = await call({ conversationId: 'conv-1', text: 'Done — 3 changes are in.' });
    expect(res.status).toBe(200);
    expect(h.appended[0]).toMatchObject({ conversationId: 'conv-1', role: 'assistant', content: 'Done — 3 changes are in.' });
    expect(lastMeta()['confirmation']).toBe(true);
    expect(lastMeta()['pendingIntent']).toBeUndefined();
  });

  it('a sentence is a sentence — the text is capped rather than trusted for length', async () => {
    await call({ conversationId: 'conv-1', text: 'x'.repeat(2000) });
    expect(String(h.appended[0]!['content']).length).toBe(500);
  });

  it('no session, no write', async () => {
    h.session = null;
    expect((await call({ conversationId: 'conv-1', text: 'Done.' })).status).toBe(401);
    expect(h.appended).toHaveLength(0);
  });

  it('another client’s conversation is not found, and nothing is appended to it', async () => {
    h.ownedRows = [];
    expect((await call({ conversationId: 'someone-elses', text: 'Done.' })).status).toBe(404);
    expect(h.appended).toHaveLength(0);
  });

  it('an empty text is a bad request — an empty turn is not a record of anything', async () => {
    expect((await call({ conversationId: 'conv-1', text: '   ' })).status).toBe(400);
  });
});

describe('THE RESCUE: one refused change becomes an intent the next utterance can amend', () => {
  it('a refused ADD seeds an add_post intent carrying its subject, format and the failed date', async () => {
    h.proposal = REFUSED_ADD;
    const res = await call({
      conversationId: 'conv-1',
      text: '2 changes went through, but not this one: Add “Launch day” — 31 October has already passed, so I couldn’t add it there. Tell me another date and I’ll put it in.',
      refusedProposalIds: ['pr-launch'],
    });
    expect(await res.json()).toMatchObject({ rescue: true });
    const intent = lastMeta()['pendingIntent'] as Record<string, unknown>;
    expect(intent['action']).toBe('add_post');
    expect(intent['slots']).toMatchObject({ subject: 'The raspberry launch', date: '2026-10-31', format: 'reel' });
    // The DATE is the slot in question, so it is marked asked — the rescue must not re-ask it.
    expect(intent['asked']).toEqual(['date']);
    // And the question is the sentence the client actually read.
    expect(String(intent['question'])).toContain('Tell me another date');
  });

  it('a refused MOVE seeds a move_post intent on its destination', async () => {
    h.proposal = { intent: 'move_post', summary: 'Move “The layers edit” to 1 October', status: 'failed', payload: { kind: 'move', cycleId: 'cyc-1', postId: 'p9', toDate: '2026-10-01' } };
    await call({ conversationId: 'conv-1', text: 'That didn’t go through.', refusedProposalIds: ['pr-move'] });
    const intent = lastMeta()['pendingIntent'] as Record<string, unknown>;
    expect(intent['action']).toBe('move_post');
    expect(intent['slots']).toMatchObject({ date: '2026-10-01' });
  });

  it('a refusal a DATE cannot fix seeds nothing — a quota is not a slot', async () => {
    h.proposal = { intent: 'rewrite_post', summary: 'Rewrite “X”', status: 'failed', payload: { kind: 'rewrite', cycleId: 'cyc-1', postId: 'p9', instruction: 'warmer' } };
    const res = await call({ conversationId: 'conv-1', text: 'That didn’t go through — you’ve used all 30 AI changes this month.', refusedProposalIds: ['pr-rw'] });
    expect(await res.json()).toMatchObject({ rescue: false });
    expect(lastMeta()['pendingIntent']).toBeUndefined();
    // The turn is still written: the client must be able to scroll back to what happened.
    expect(h.appended).toHaveLength(1);
  });

  it('TWO refused changes seed nothing — there is no single slot for two different dates', async () => {
    h.proposal = REFUSED_ADD;
    await call({ conversationId: 'conv-1', text: 'Not these two.', refusedProposalIds: ['a', 'b'] });
    expect(lastMeta()['pendingIntent']).toBeUndefined();
  });

  it('a proposal that is not this client’s seeds nothing (the load is client-scoped)', async () => {
    h.proposal = null;
    await call({ conversationId: 'conv-1', text: 'Not that one.', refusedProposalIds: ['someone-elses'] });
    expect(lastMeta()['pendingIntent']).toBeUndefined();
  });

  it('the client cannot post an intent of their own — only ids, and the payload decides', async () => {
    h.proposal = REFUSED_ADD;
    await call({
      conversationId: 'conv-1', text: 'Done.', refusedProposalIds: ['pr-launch'],
      pendingIntent: { action: 'delete_post', slots: { subject: 'everything' } },
    });
    const intent = lastMeta()['pendingIntent'] as Record<string, unknown>;
    expect(intent['action']).toBe('add_post');                        // derived, not accepted
    expect(intent['slots']).toMatchObject({ subject: 'The raspberry launch' });
  });
});
