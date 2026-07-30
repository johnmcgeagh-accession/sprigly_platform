/**
 * resolution-rules.test.ts — F3: how a relative reference becomes a date.
 *
 * THE RULES:
 *   a) "Friday's post" means the NEXT Friday from today (today counts when it is a Friday) —
 *      never "every Friday this month is ambiguous, which one?". The interpretation line SHOWS
 *      the resolved date, so a wrong default is visible and discardable; the agent asks only
 *      when the resolved DAY itself holds more than one post — and then it LISTS them.
 *   b) "tomorrow", "next week", "the 14th" resolve against TODAY and the viewed month. The
 *      parser prompt carries a day table (today + 14 days with weekdays) so none of that is
 *      arithmetic; these tests pin the deterministic layer and the table itself.
 *
 * Pinned mid-month: today = 2026-08-12, a Wednesday. August 2026's Fridays are the 7th, 14th,
 * 21st and 28th.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlanPost } from '../types';
import type { ParsedTask } from './types';

const P = (id: string, date: string, caption: string, format = 'single'): PlanPost => ({
  id, cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date,
  format, pillar: 'Style', caption, status: 'planned', reviewState: null, steps: [],
} as never);

/** Fridays past and future, and a Wednesday. "Friday's post" must mean the 14th. */
const POSTS = [
  P('p-fri-07', '2026-08-07', 'The gone Friday'),
  P('p-wed-12', '2026-08-12', 'Midweek'),
  P('p-fri-14', '2026-08-14', 'Weekend Style Guide'),
  P('p-fri-21', '2026-08-21', 'The later Friday'),
];

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  posts: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [...h.posts] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', async (orig) => ({
  ...(await orig<typeof import('./task-parser')>()),          // keep dayTable real
  parseTasks: async () => h.tasks,
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
vi.mock('@/lib/agent/conversation', () => ({ ensureConversation: async () => 'conv-1', appendMessage: async () => 'msg-1' }));
vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => {
    h.createCalls.push(args);
    return { id: `pv-${h.createCalls.length}`, intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId };
  },
  // C3: nothing pending in these fixtures — they test resolution, not amendment.
  loadPendingPayloads: async () => [],
  rejectProposal: async () => null,
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: async () => 'answer' }));
// Mid-month Wednesday, through the write gate's own freeze door.
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-08-12', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { resolveTargets } from './selectors';
import { dayTable } from './task-parser';
import { lineFor } from '@/components/plan/surface/Interpretation';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice' });

beforeEach(() => {
  h.tasks = [];
  h.posts = [...POSTS];
  h.createCalls.length = 0;
});

describe('a) "Friday\'s post" is the NEXT Friday from today', () => {
  it('the deterministic resolver picks the 14th — not "which of three Fridays?"', () => {
    const hits = resolveTargets("friday's post", POSTS as PlanPost[], '2026-08-12');
    expect(hits.map((p) => p.id)).toEqual(['p-fri-14']);
  });

  it('today counts when today IS that weekday', () => {
    const hits = resolveTargets('the wednesday post', POSTS as PlanPost[], '2026-08-12');
    expect(hits.map((p) => p.id)).toEqual(['p-wed-12']);
  });

  it('with no upcoming occurrence, the reference still finds the one such post', () => {
    const only = [P('p-fri-07', '2026-08-07', 'The gone Friday')];
    const hits = resolveTargets('the friday post', only as PlanPost[], '2026-08-28');
    expect(hits.map((p) => p.id)).toEqual(['p-fri-07']);   // refused honestly downstream, not lost here
  });

  it('FIXTURE: "move Friday\'s post to Saturday" mid-month → one proposal, next Friday, no question', async () => {
    h.tasks = [{ action: 'move_post', selector: "Friday's post", toDate: '2026-08-15', reason: "move Friday's post to Saturday" }] as ParsedTask[];
    const r = await ask("move Friday's post to Saturday");

    expect(r.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.payload).toMatchObject({ kind: 'move', postId: 'p-fri-14', toDate: '2026-08-15' });
    // The interpretation carries BOTH resolved dates — the visible wrong-guess contract.
    expect(r.items[0]).toMatchObject({
      kind: 'change', action: 'move', title: 'Weekend Style Guide',
      fromDate: '2026-08-14', toDate: '2026-08-15',
    });
  });

  it('FIXTURE: two posts on that Friday → it ASKS, listing the two', async () => {
    h.posts = [...POSTS, P('p-fri-14b', '2026-08-14', 'Behind the seams')];
    h.tasks = [{ action: 'move_post', selector: 'the Friday post', toDate: '2026-08-15', reason: "move Friday's post" }] as ParsedTask[];
    const r = await ask("move Friday's post to Saturday");

    expect(h.createCalls).toHaveLength(0);
    expect(r.items[0]!.kind).toBe('unresolved');
    const q = (r.items[0] as { question: string }).question;
    expect(q).toContain('Weekend Style Guide');
    expect(q).toContain('Behind the seams');
    expect(q).toContain('14 August');
  });

  it('ambiguity on a NON-move action lists the candidates too, instead of "name its date"', async () => {
    h.posts = [...POSTS, P('p-fri-14b', '2026-08-14', 'Behind the seams')];
    h.tasks = [{ action: 'rewrite_post', selector: 'the Friday post', instruction: 'warmer', reason: 'warm up the Friday post' }] as ParsedTask[];
    const r = await ask('warm up the Friday post');

    expect(h.createCalls).toHaveLength(0);
    const q = (r.items[0] as { question: string }).question;
    expect(q).toContain('Weekend Style Guide');
    expect(q).toContain('Behind the seams');
  });
});

describe('the move line shows the resolved source date', () => {
  it('lineFor(move) renders "from → to" so a wrong resolution is visible before Apply', () => {
    const line = lineFor({ kind: 'change', proposalId: 'pv-1', action: 'move', title: 'Weekend Style Guide', fromDate: '2026-08-14', toDate: '2026-08-15' });
    expect(line.tail).toBe('Fri 14 Aug → Sat 15 Aug');
  });
});

describe('b) the day table the parser resolves relative references from', () => {
  it('opens on today, marks tomorrow, and names the weekdays right', () => {
    const t = dayTable('2026-08-12');
    expect(t).toContain('- 2026-08-12 = Wednesday (TODAY)');
    expect(t).toContain('- 2026-08-13 = Thursday (tomorrow)');
    expect(t).toContain('- 2026-08-14 = Friday');
    expect(t).toContain('- 2026-08-15 = Saturday');
    expect(t).toContain('- 2026-08-26 = Wednesday');           // 14 days out — the table's edge
  });

  it('crosses a month boundary without losing the year or the weekday', () => {
    const t = dayTable('2026-07-30');
    expect(t).toContain('- 2026-07-30 = Thursday (TODAY)');
    expect(t).toContain('- 2026-08-01 = Saturday');
    expect(t).toContain('- 2026-08-13 = Thursday');            // 14 days out — the table's edge, over the boundary
  });
});
