/**
 * thread-context.test.ts — "move it back" resolves against the previous exchange.
 *
 * The conversation sheet's contract: the thread is one running conversation about the month,
 * sent with each turn as a bounded window (threadForParser), with assistant turns serialised
 * from their RESOLVED items — titles and ISO dates, never prose. The fixture from the brief:
 * move 3rd → 8th, then "move it back" → the interpretation shows 8th → 3rd.
 *
 * The model itself is faked (as everywhere in this harness); what these tests pin is the
 * PLUMBING the model needs to be right: the window reaches the parser, it contains the client's
 * phrasing AND the resolved dates of the previous change, the prompt states the resolution
 * rules, and the second turn's move flows through to an 8th → 3rd interpretation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlanPost } from '../types';
import type { ParsedTask } from './types';
import type { ParserContext } from './task-parser';
import type { ConversationTurn } from './conversation';

const P = (id: string, date: string, caption: string): PlanPost => ({
  id, cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date,
  format: 'single', pillar: 'Style', caption, status: 'planned', reviewState: null, steps: [],
} as never);

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  posts: [] as unknown[],
  contexts: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
  /** The in-memory conversation store the mocked persistence writes to and reads from. */
  turns: [] as Array<{ conversationId: string; role: 'user' | 'assistant'; content: string; metadata?: Record<string, unknown> }>,
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, conversations: {}, agentMessages: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [...h.posts] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', async (orig) => ({
  ...(await orig<typeof import('./task-parser')>()),
  parseTasks: async (_t: string, ctx: unknown) => { h.contexts.push(ctx); return h.tasks; },
}));
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  const ROWS = [{ id: 'cyc-aug', month: '2026-07', status: 'workbook_built' }];   // plans AUGUST
  return {
    ...real,
    getClientCycleMonths: async (_c: string, viewed: string) => real.describeCycles(ROWS, viewed),
    getCycleMonth: async () => real.planMonthOf('2026-07'),
  };
});
// The persistence, faked over an in-memory store — threadForParser stays REAL, because the
// serialisation it produces is half of what these tests exist to pin.
vi.mock('@/lib/agent/conversation', async (orig) => {
  const real = await orig<typeof import('./conversation')>();
  return {
    ...real,
    // The SESSION's conversation, as the sheet passes it in on every turn (per-session ruling).
    ensureConversation: async (_c: string, _cy: string | null, id?: string) => id ?? 'conv-1',
    // Turns are stored PER CONVERSATION — which is what makes the window a session's, not a
    // month's. A turn in `conv-2` can never see `conv-1`'s.
    listTurns: async (_c: string, conversationId: string): Promise<ConversationTurn[]> =>
      h.turns.filter((t) => t.conversationId === conversationId).map((t, i) => ({
        id: `m${i}`, role: t.role, content: t.content, source: 'voice' as const,
        createdAt: new Date(2026, 7, 1, 12, i).toISOString(),
        ...(t.metadata?.['items'] ? { items: t.metadata['items'] as never } : {}),
      })),
    appendMessage: async (a: { conversationId: string; role: 'user' | 'assistant'; content: string; metadata?: Record<string, unknown> }) => {
      h.turns.push({ conversationId: a.conversationId, role: a.role, content: a.content, ...(a.metadata ? { metadata: a.metadata } : {}) });
      return `m${h.turns.length}`;
    },
  };
});
vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => {
    h.createCalls.push(args);
    return { id: `pv-${h.createCalls.length}`, intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId };
  },
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: async () => 'answer' }));
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-08-01', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { TASK_PARSER_SYSTEM_PROMPT } from './task-parser';
import { threadForParser } from './conversation';

const ask = (instruction: string, conversationId = 'conv-1') =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice', conversationId });
const lastCtx = () => h.contexts[h.contexts.length - 1] as ParserContext;

beforeEach(() => {
  h.tasks = [];
  h.posts = [P('p-a', '2026-08-03', 'Linen, one more time')];
  h.contexts.length = 0;
  h.createCalls.length = 0;
  h.turns.length = 0;
});

describe('the fixture: move 3rd → 8th, then "move it back" → 8th → 3rd', () => {
  it('runs end to end through the real thread plumbing', async () => {
    // TURN 1 — the move. Parsed, proposed, and persisted with its resolved items.
    h.tasks = [{ action: 'move_post', fromDate: '2026-08-03', toDate: '2026-08-08', reason: 'move the post on the 3rd to the 8th' }] as ParsedTask[];
    const r1 = await ask('move the post on the 3rd to the 8th');
    expect(r1.items[0]).toMatchObject({ action: 'move', fromDate: '2026-08-03', toDate: '2026-08-08' });
    // The assistant turn stored its items — the thread's memory of what resolved.
    const assistant = h.turns.find((t) => t.role === 'assistant')!;
    expect((assistant.metadata?.['items'] as unknown[])).toHaveLength(1);

    // The change applied: the post now sits on the 8th (the digest is the plan as it stands).
    h.posts = [P('p-a', '2026-08-08', 'Linen, one more time')];

    // TURN 2 — "move it back". The parser, given the thread, reverses the move.
    h.tasks = [{ action: 'move_post', postId: 'p-a', fromDate: '2026-08-08', toDate: '2026-08-03', reason: 'move it back' }] as ParsedTask[];
    const r2 = await ask('move it back');

    // The window reached the parser, carrying the client's phrasing AND the resolved dates.
    const ctx = lastCtx();
    expect(ctx.recentThread).toContain('CLIENT: move the post on the 3rd to the 8th');
    expect(ctx.recentThread).toContain('2026-08-03 → 2026-08-08');
    // …and the interpretation shows the reversal.
    expect(r2.items[0]).toMatchObject({ kind: 'change', action: 'move', title: 'Linen, one more time', fromDate: '2026-08-08', toDate: '2026-08-03' });
  });

  it('the window is read BEFORE this turn’s message lands — the thread is the conversation as it stood', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('first message');
    expect((h.contexts[0] as ParserContext).recentThread).toBe('');   // a fresh thread is empty
    await ask('second message');
    const second = (h.contexts[1] as ParserContext).recentThread ?? '';
    expect(second).toContain('CLIENT: first message');
    expect(second).not.toContain('second message');
  });

  /**
   * C1: the context window is THIS SESSION's turns, and nothing older. Each sheet open is its
   * own conversation, so a reference cannot reach back into one the client has closed — the
   * per-cycle window let a three-week-old exchange compete with what they had just said.
   */
  it('a NEW session sees none of the last one — the window is the conversation, not the month', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-08-03', toDate: '2026-08-08' }] as ParsedTask[];
    await ask('move the post on the 3rd to the 8th', 'conv-1');
    expect(h.turns.length).toBeGreaterThan(0);

    // The sheet is closed and reopened: a different conversation entirely.
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('anything', 'conv-2');

    const ctx = lastCtx();
    expect(ctx.recentThread).toBe('');
    expect(ctx.recentThread).not.toContain('the 3rd');
    // …and the earlier session is still STORED, just not read.
    expect(h.turns.some((t) => t.conversationId === 'conv-1')).toBe(true);
  });
});

describe('threadForParser — the serialisation the model reads', () => {
  const turn = (over: Partial<ConversationTurn>): ConversationTurn => ({
    id: 'm1', role: 'user', content: '', source: 'voice', createdAt: '2026-08-01T12:00:00Z', ...over,
  });

  it('an interpretation turn serialises its RESOLVED items, not its prose fallback', () => {
    const s = threadForParser([
      turn({ role: 'user', content: 'move the post on the 3rd to the 8th' }),
      turn({
        role: 'assistant', content: 'Proposed 1 change for review.',
        items: [{ kind: 'change', proposalId: 'pv-1', action: 'move', title: 'Linen, one more time', fromDate: '2026-08-03', toDate: '2026-08-08' }],
      }),
    ]);
    expect(s).toContain('ASSISTANT: move "Linen, one more time" 2026-08-03 → 2026-08-08');
    expect(s).not.toContain('Proposed 1 change');
  });

  it('the window is bounded — only the most recent turns ride along', () => {
    const many = Array.from({ length: 30 }, (_, i) => turn({ id: `m${i}`, content: `message ${i}` }));
    const s = threadForParser(many, 12);
    expect(s).not.toContain('message 17');
    expect(s).toContain('message 18');
    expect(s).toContain('message 29');
  });
});

describe('the prompt states the resolution rules', () => {
  it('names "move it back" and rules the digest over the thread for current positions', () => {
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('THE CONVERSATION SO FAR');
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('"move it back"');
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('The thread NEVER overrides the digest');
  });
});
