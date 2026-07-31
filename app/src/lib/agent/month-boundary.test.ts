/**
 * month-boundary.test.ts — THE PLAN RUNS TO THE MONTH'S END, NOT TO ITS LAST POST (G2).
 *
 * Live evidence (Earl of East, October): the agent told the client the plan "runs up to the
 * 28th" and refused later dates. There is no such rule anywhere in this codebase. A post may be
 * added on any date from today onwards (`add-policy.ts:canAddPost`), the move guard compares
 * against the cycle's PLAN MONTH (`turn.ts`), and a cycle plans a whole calendar month.
 *
 * The sentence came from the only evidence the model had. Both context builders listed the
 * posts and stated nothing about the month, so the plan's extent was inferrable only as
 * max(scheduled_date): last post on the 28th, therefore plan ends on the 28th. A gap at the end
 * of a month read as the end of the month — and the same reasoning would have refused the 30th
 * of any month whose last post was the 27th.
 *
 * Two derivations were at fault and both are fixed here:
 *   1. LABELLING — `cycleDigest` and `bucketCycleState` now open with the plan's calendar
 *      window (`planWindowLine`), and both prompts state that an empty date inside it is empty
 *      rather than absent.
 *   2. PLACEMENT — `defaultAddDate` put an undated add two days after the LAST POST, which from
 *      the 30th lands in the next month: a post proposed into a month this cycle does not plan.
 *      It is clamped to the plan month now.
 *
 * The fixture is the October cycle from the report: five posts, the last on the 28th.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from './types';
import type { ParserContext } from './task-parser';

/** The October plan as the client had it: nothing after the 28th. */
const OCT_POSTS = [
  { id: 'p-oct-06', cycleId: 'cyc-oct', clientId: 'c1', channel: 'instagram', date: '2026-10-06', format: 'reel', pillar: 'Home & Space', caption: 'The candle edit', status: 'planned', reviewState: null },
  { id: 'p-oct-13', cycleId: 'cyc-oct', clientId: 'c1', channel: 'instagram', date: '2026-10-13', format: 'carousel', pillar: 'Home & Space', caption: 'Layering scents', status: 'planned', reviewState: null },
  { id: 'p-oct-20', cycleId: 'cyc-oct', clientId: 'c1', channel: 'instagram', date: '2026-10-20', format: 'single', pillar: 'Ritual', caption: 'Evening ritual', status: 'planned', reviewState: null },
  { id: 'p-oct-28', cycleId: 'cyc-oct', clientId: 'c1', channel: 'instagram', date: '2026-10-28', format: 'reel', pillar: 'Ritual', caption: 'The last one', status: 'planned', reviewState: null },
];

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  contexts: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
  posts: [] as unknown[],
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [...h.posts] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', async (orig) => ({
  // The REAL prompt is kept: the last case asserts the rule is stated in words, and a mocked
  // prompt would assert nothing.
  ...(await orig<typeof import('./task-parser')>()),
  parseTasks: async (_t: string, ctx: unknown) => { h.contexts.push(ctx); return h.tasks; },
}));
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  const ROWS = [{ id: 'cyc-oct', month: '2026-09', status: 'workbook_built' }];   // plans OCTOBER
  return {
    ...real,
    getClientCycleMonths: async (_c: string, viewed: string) => real.describeCycles(ROWS, viewed),
    getCycleMonth: async () => real.planMonthOf('2026-09'),
  };
});
vi.mock('@/lib/agent/conversation', () => ({
  ensureConversation: async () => 'conv-1', appendMessage: async () => 'msg-1',
  listTurns: async () => [], threadForParser: () => '',
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
vi.mock('@/lib/agent/query', async (orig) => ({
  ...(await orig<typeof import('./query')>()),
  answerQuery: async () => 'answer',
}));
// Mid-October, so every date in the fixture's second half is still ahead.
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-10-15', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { bucketCycleState, cycleDigest, planWindowLine } from './cycle-state';
import { TASK_PARSER_SYSTEM_PROMPT } from './task-parser';
import { QUERY_SYSTEM_PROMPT } from './query';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-oct', instruction, source: 'voice' });
const lastCtx = () => h.contexts[h.contexts.length - 1] as ParserContext;

beforeEach(() => {
  h.tasks = [];
  h.contexts.length = 0;
  h.createCalls.length = 0;
  h.posts = [...OCT_POSTS];
});

describe('THE OCTOBER CASE: adding on the 31st, when the last post is the 28th', () => {
  it('the add is PROPOSED, on the 31st, with no refusal anywhere', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-10-31', format: 'reel', instruction: 'The Halloween launch', reason: 'add the launch on the 31st' }] as ParsedTask[];
    const r = await ask('add the launch reel on the 31st');
    expect(r.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.payload).toMatchObject({ kind: 'add', date: '2026-10-31' });
    expect(r.message ?? '').not.toMatch(/runs up to|past|passed|isn’t available/i);
  });

  it('and a MOVE onto the 31st is permitted — the guard compares plan months, not last posts', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-10-20', toDate: '2026-10-31', reason: 'move it to the 31st' }] as ParsedTask[];
    const r = await ask('move the 20th to the 31st');
    expect(r.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.payload).toMatchObject({ kind: 'move', toDate: '2026-10-31' });
  });
});

describe('the boundary is STATED, so it cannot be inferred from the last row', () => {
  it('the digest opens with the plan’s calendar window, naming the month’s real last day', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('anything');
    const digest = lastCtx().planDigest;
    expect(digest).toContain('2026-10-01 to 2026-10-31');
    expect(digest).toContain('October 2026');
    // The last row is still the 28th — the window is what says the plan does not end there.
    expect(digest).toContain('2026-10-28');
  });

  it('the window says an empty date inside it is EMPTY, not outside the plan', () => {
    const line = planWindowLine('2026-10')!;
    expect(line).toContain('EMPTY date in the plan');
    expect(line).toMatch(/never refuse a date/i);
  });

  it('the window is the calendar’s, not a guess: February and a leap February', () => {
    expect(planWindowLine('2027-02')).toContain('2027-02-01 to 2027-02-28');
    expect(planWindowLine('2028-02')).toContain('2028-02-01 to 2028-02-29');
    expect(planWindowLine('2026-11')).toContain('2026-11-01 to 2026-11-30');
  });

  it('an EMPTY plan still states its window — a month with no posts has no last row at all', () => {
    expect(cycleDigest([], '2026-10-15', '2026-10')).toContain('2026-10-01 to 2026-10-31');
  });

  it('no plan month → no window line, and the digest is exactly what it always was', () => {
    expect(planWindowLine(null)).toBeNull();
    expect(planWindowLine('October')).toBeNull();
    expect(cycleDigest(OCT_POSTS as never, '2026-10-15')).not.toContain('THIS PLAN COVERS');
  });

  it('the query answerer’s plan state carries the window too — it reads nothing else', () => {
    const state = bucketCycleState(OCT_POSTS as never, new Date(2026, 9, 15), '2026-10');
    expect(state.summary).toContain('2026-10-01 to 2026-10-31');
    expect(state.summary).toContain('TODAY IS 2026-10-15');
  });

  it('both prompts state the rule in words, not only in data', () => {
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('NEVER ITS LAST POST');
    expect(QUERY_SYSTEM_PROMPT).toContain('NOT ITS LAST POST');
  });
});

describe('the OTHER max(scheduled_date) derivation: where an undated add lands', () => {
  it('two days after the last post, when that is still inside the month', async () => {
    h.tasks = [{ action: 'add_post', instruction: 'Something new', reason: 'add a post' }] as ParsedTask[];
    await ask('add a post');
    expect(h.createCalls[0]!.payload).toMatchObject({ date: '2026-10-30' });   // 28th + 2
  });

  it('CLAMPED at the month’s end rather than proposed into a month this cycle doesn’t plan', async () => {
    h.posts = [...OCT_POSTS, { ...OCT_POSTS[3]!, id: 'p-oct-30', date: '2026-10-30', caption: 'Later still' }];
    h.tasks = [{ action: 'add_post', instruction: 'Something new', reason: 'add a post' }] as ParsedTask[];
    await ask('add a post');
    // 30th + 2 = 1 November, which this October cycle does not plan and the move guard would
    // then refuse to bring back. The clamp keeps the default inside the plan.
    expect(h.createCalls[0]!.payload).toMatchObject({ date: '2026-10-31' });
  });

  it('and never behind today, even when the clamp pulls backwards', async () => {
    // A plan whose posts are all in the past: the clamp's floor is today, which IS addable.
    h.posts = [{ ...OCT_POSTS[0]!, date: '2026-10-01' }];
    h.tasks = [{ action: 'add_post', instruction: 'Something new', reason: 'add a post' }] as ParsedTask[];
    await ask('add a post');
    expect(h.createCalls[0]!.payload).toMatchObject({ date: '2026-10-15' });
  });
});
