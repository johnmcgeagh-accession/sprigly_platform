/**
 * cap-announcement.test.ts — X2a: the cap is raised BEFORE the work.
 *
 * Found live: a request that exceeded the monthly allowance produced posts that were refused at
 * apply time, stored an honest message nobody surfaced, and rendered as "On its way". The client
 * learned about the cap by watching nothing happen.
 *
 * These pin the two halves of the fix that live in the turn loop: WHICH changes are counted as
 * expensive, and that a request that fits says nothing at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from './types';

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  posts: [] as unknown[],
  usage: { used: 0, limit: 30, overrideUntil: null as string | null, resetsOn: '2026-08-01T00:00:00.000Z', unlimited: false },
  usageThrows: false,
  createCalls: [] as Array<Record<string, unknown>>,
  turnMeta: [] as Array<Record<string, unknown>>,
  rows: [{ id: 'cyc-aug', month: '2026-07', status: 'workbook_built' }],
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@sprigly/audit', () => ({ createAuditLogger: () => ({ logModelCall: async () => undefined }) }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [...h.posts] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}), AGENT_MODEL: 'fake' }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', () => ({ parseTasks: async () => h.tasks }));
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  return {
    ...real,
    listClientCycles: async () => h.rows,
    getClientCycleMonths: async (_c: string, viewed: string) => real.describeCycles(h.rows, viewed),
    getCycleMonth: async () => real.planMonthOf('2026-07'),
  };
});
vi.mock('@/lib/agent/conversation', () => ({
  ensureConversation: async () => 'conv-1',
  appendMessage: async (a: Record<string, unknown>) => { h.turnMeta.push((a.metadata ?? {}) as Record<string, unknown>); return 'msg-1'; },
  listTurns: async () => [], threadForParser: () => '', latestPendingIntent: () => null, intentForParser: () => '',
}));
vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => {
    h.createCalls.push(args);
    return { id: `pv-${h.createCalls.length}`, intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId };
  },
  loadPendingPayloads: async () => [],
  rejectProposal: async () => null,
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: async () => 'answer' }));
// The REAL cap arithmetic and copy — this file is about what the turn DOES with them.
vi.mock('@/lib/usage', async () => {
  const cap = await import('@sprigly/engine/ai-change-cap');
  return {
    getUsageForCycle: async () => { if (h.usageThrows) throw new Error('db down'); return h.usage; },
    isRewriteBlocked: (u: never) => cap.isCapReached(u),
    remainingAiChanges: (u: never) => cap.remainingChanges(u),
  };
});
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-07-31', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice' });

/** Three adds — three captions to write, three AI changes. */
const THREE_ADDS = [
  { action: 'add_post', toDate: '2026-08-14', format: 'reel', instruction: 'Oak tree tease.' },
  { action: 'add_post', toDate: '2026-08-16', format: 'reel', instruction: 'Oak tree launch.' },
  { action: 'add_post', toDate: '2026-08-18', format: 'reel', instruction: 'Oak tree in use.' },
] as ParsedTask[];

const POST = { id: 'p1', cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date: '2026-08-20', format: 'reel', pillar: 'Launch', caption: 'Atlas Cedar', status: 'planned', reviewState: null };

beforeEach(() => {
  h.tasks = []; h.createCalls.length = 0; h.turnMeta.length = 0;
  h.posts = [{ ...POST }];
  h.usage = { used: 0, limit: 30, overrideUntil: null, resetsOn: '2026-08-01T00:00:00.000Z', unlimited: false };
  h.usageThrows = false;
});

describe('the announcement', () => {
  it('names how many the request needs, how many are left, and the reset date', async () => {
    h.usage.used = 29;                       // one left, three needed
    h.tasks = THREE_ADDS;
    const r = await ask('tease it, launch it, show it in use');

    expect(r.capNotice).toEqual({ needed: 3, remaining: 1, limit: 30, resetsOn: '2026-08-01T00:00:00.000Z' });
    expect(r.message).toContain('3 changes');
    expect(r.message).toContain('1 left this month');
    expect(r.message).toContain('1 August');
  });

  it('OFFERS to bank it rather than refusing — the proposals are still made', async () => {
    h.usage.used = 30;
    h.tasks = THREE_ADDS;
    const r = await ask('tease it, launch it, show it in use');

    expect(r.proposals).toHaveLength(3);      // nothing is withheld
    expect(r.items.filter((i) => i.kind === 'change')).toHaveLength(3);
    expect(r.message).toMatch(/save the whole thing/);
    expect(r.message).not.toMatch(/can’t|cannot|sorry/i);
  });

  it('says nothing at all when the request fits', async () => {
    h.usage.used = 10;
    h.tasks = THREE_ADDS;
    const r = await ask('tease it, launch it, show it in use');
    expect(r.capNotice).toBeUndefined();
    expect(r.message).not.toMatch(/this month/);
  });

  it('and nothing for an unlimited client — they are never given a count', async () => {
    h.usage = { used: 999, limit: 30, overrideUntil: '2026-12-01T00:00:00Z', resetsOn: '2026-08-01T00:00:00.000Z', unlimited: true };
    h.tasks = THREE_ADDS;
    const r = await ask('tease it, launch it, show it in use');
    expect(r.capNotice).toBeUndefined();
  });

  it('rides on the persisted turn, so a reopened thread shows the same notice', async () => {
    h.usage.used = 30;
    h.tasks = THREE_ADDS;
    await ask('tease it, launch it, show it in use');
    const last = h.turnMeta[h.turnMeta.length - 1]!;
    expect(last['capNotice']).toMatchObject({ needed: 3, remaining: 0 });
  });
});

describe('which changes cost — the cap governs the EXPENSIVE path only', () => {
  const one = (task: Record<string, unknown>) => { h.tasks = [task as unknown as ParsedTask]; };

  it('a MOVE is free: structural, no model in it', async () => {
    h.usage.used = 30;
    one({ action: 'move_post', postId: 'p1', fromDate: '2026-08-20', toDate: '2026-08-22' });
    const r = await ask('move it to the 22nd');
    expect(r.proposals).toHaveLength(1);
    expect(r.capNotice).toBeUndefined();
  });

  it('a DELETE and a FORMAT CHANGE are free too', async () => {
    h.usage.used = 30;
    h.tasks = [
      { action: 'delete_post', postId: 'p1' },
    ] as ParsedTask[];
    expect((await ask('remove it')).capNotice).toBeUndefined();

    h.createCalls.length = 0;
    h.tasks = [{ action: 'change_format', postId: 'p1', format: 'carousel' }] as ParsedTask[];
    expect((await ask('make it a carousel')).capNotice).toBeUndefined();
  });

  it('a REWRITE costs one', async () => {
    h.usage.used = 30;
    one({ action: 'rewrite_post', postId: 'p1', instruction: 'warmer' });
    const r = await ask('make it warmer');
    expect(r.capNotice).toMatchObject({ needed: 1, remaining: 0 });
  });

  it('a compound ask counts only the expensive half', async () => {
    h.usage.used = 29;                       // one left
    h.tasks = [
      { action: 'move_post', postId: 'p1', fromDate: '2026-08-20', toDate: '2026-08-22' },
      { action: 'add_post', toDate: '2026-08-24', instruction: 'The restock.' },
      { action: 'add_post', toDate: '2026-08-26', instruction: 'The follow-up.' },
    ] as ParsedTask[];
    const r = await ask('move it, and add two');
    expect(r.capNotice).toMatchObject({ needed: 2, remaining: 1 });
  });
});

describe('it is a sentence, not a gate', () => {
  it('an unreadable allowance changes nothing about what the client may ask for', async () => {
    h.usageThrows = true;
    h.tasks = THREE_ADDS;
    const r = await ask('tease it, launch it, show it in use');

    expect(r.proposals).toHaveLength(3);
    expect(r.capNotice).toBeUndefined();
    expect(r.message).not.toMatch(/this month/);
  });

  it('a turn with no expensive change never reads the allowance at all', async () => {
    h.usageThrows = true;   // would throw if it were consulted
    h.tasks = [{ action: 'move_post', postId: 'p1', fromDate: '2026-08-20', toDate: '2026-08-22' }] as ParsedTask[];
    const r = await ask('move it');
    expect(r.proposals).toHaveLength(1);
  });
});
