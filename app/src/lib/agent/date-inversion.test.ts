/**
 * date-inversion.test.ts — the third screenshot, as a fixture.
 *
 * Live evidence (operator's phone, 30 July 2026):
 *
 *   "The post on the 14th of August is in August 2026, which is in the past
 *    (today is 30 July 2026)."
 *
 * A date a fortnight in the FUTURE, called past, in the same sentence as the correct today.
 * The deterministic guards were never backwards — `isEditableDate` is a lexical `>=` on ISO
 * strings (edit-scope.ts:26) and turn.ts calls it the right way round on both ends of a move
 * (turn.ts). The inversion happened in the MODEL's own arithmetic, and the prompt gave it every
 * chance to: the digest rows carried no year at all (`fmtDate` → 'Fri 14 Aug', selectors.ts:41)
 * and nothing anywhere stated which side of today each row sat on, so "is that past?" was left
 * as date arithmetic for a small model — which it got wrong out loud.
 *
 * The fix states the answer instead of setting the exercise:
 *   · every digest row carries its full ISO date, and rows before today are marked
 *     '[past — read-only]' with the SAME predicate the write gate uses (cycle-state.ts,
 *     cycleDigest);
 *   · the query answerer's plan state opens with 'TODAY IS <iso>' and marks past rows the same
 *     way (cycle-state.ts, bucketCycleState), and its system prompt forbids calling a date past
 *     unless the row says so (query.ts);
 *   · the parser prompt states the comparison rule and forbids self-enforcing editability
 *     (task-parser.ts, DATES section);
 *   · the turn's "today" is `editScopeToday()` — London, the write gate's own clock — rather
 *     than the server's local calendar (turn.ts, agentToday).
 *
 * These run the real `runPlanAgentTurn` pinned to the day of the screenshot: 2026-07-30.
 * On that day, editing 14 August is PERMITTED; editing 29 July is REFUSED, honestly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from './types';
import type { ParserContext } from './task-parser';

/** The client's August plan as the screenshot saw it: one post still ahead, one just gone. */
const AUG_POSTS = [
  { id: 'p-aug-14', cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date: '2026-08-14', format: 'carousel', pillar: 'Weekend Style Guide', caption: 'Lily tee + Sophie co-ord', status: 'planned', reviewState: null },
  { id: 'p-jul-29', cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date: '2026-07-29', format: 'single', pillar: 'Late summer', caption: 'Yesterday’s post', status: 'planned', reviewState: null },
];

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  contexts: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [...AUG_POSTS] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', () => ({
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
// THE DAY OF THE SCREENSHOT. Frozen through the same door production's e2e freeze uses:
// editScopeToday() → resolveTodayIso() → e2eTodayIso().
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-07-30', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { bucketCycleState } from './cycle-state';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice' });
const lastCtx = () => h.contexts[h.contexts.length - 1] as ParserContext;

beforeEach(() => {
  h.tasks = [];
  h.contexts.length = 0;
  h.createCalls.length = 0;
});

describe('the screenshot sentence is unsayable — 14 August is NOT past on 30 July', () => {
  it('a rewrite of the 14 Aug post goes through as a proposal, with no refusal anywhere', async () => {
    h.tasks = [{ action: 'rewrite_post', postId: 'p-aug-14', selector: 'the post on the 14th', instruction: 'make it warmer', reason: 'edit the post on the 14th of August' }] as ParsedTask[];
    const r = await ask('edit the post on the 14th of August');
    expect(r.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.payload).toMatchObject({ postId: 'p-aug-14' });
    expect(r.message ?? '').not.toMatch(/past|passed/i);
  });

  it('a move of the 14 Aug post is permitted on both ends', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-08-14', toDate: '2026-08-15', reason: 'move the 14th to the 15th' }] as ParsedTask[];
    const r = await ask('move the 14th to the 15th');
    expect(r.proposals).toHaveLength(1);
    expect(r.message ?? '').not.toMatch(/past|passed/i);
  });

  it('editing 29 July IS refused, and the refusal is honest about which date and why', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-07-29', toDate: '2026-08-15', reason: 'move yesterday’s post' }] as ParsedTask[];
    const r = await ask('move yesterday’s post to the 15th');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toContain('29 July');
    expect(r.message).toMatch(/already passed/);
    // It names the date that HAS passed — never the future one.
    expect(r.message).not.toContain('August');
  });
});

describe('the prompt states each date’s side of today instead of setting arithmetic homework', () => {
  it('the parser context declares today and gives every digest row its full ISO date', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('anything');
    const ctx = lastCtx();
    expect(ctx.today).toBe('2026-07-30');
    expect(ctx.planDigest).toContain('2026-08-14');          // the year is ON the row now
    expect(ctx.planDigest).toContain('2026-07-29');
  });

  it('the 29 Jul row is marked past; the 14 Aug row is NOT', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('anything');
    const rows = lastCtx().planDigest.split('\n');
    const jul29 = rows.find((l) => l.includes('2026-07-29'))!;
    const aug14 = rows.find((l) => l.includes('2026-08-14'))!;
    expect(jul29).toContain('[past — read-only]');
    expect(aug14).not.toContain('past');
  });

  it('the query answerer’s plan state opens with today and marks past rows the same way', () => {
    const state = bucketCycleState(AUG_POSTS as never, new Date(2026, 6, 30));
    expect(state.summary).toContain('TODAY IS 2026-07-30');
    const lines = state.summary.split('\n');
    expect(lines.find((l) => l.includes('2026-07-29'))).toContain('[past — read-only]');
    expect(lines.find((l) => l.includes('2026-08-14'))).not.toContain('past');
  });
});
