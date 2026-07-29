/**
 * screenshot-cases.test.ts — the two things the agent actually said, as fixtures.
 *
 * Both came off the operator's phone in the same session, one month apart on the same surface:
 *
 *   AUGUST view →  "August 5th is in a past workbook… I can only edit posts in the current
 *                   September 2026 cycle"
 *   SEPTEMBER view → "the plan digest shows posts starting October 1st"
 *
 * Neither sentence was a hallucination. The first is `getClientCycleMonths` marking one cycle
 * "[current, editable]" while the turn ran against the magic link's cycle rather than the month on
 * screen. The second is the same list naming a cycle by its DATA month while `cycleDigest` listed
 * that cycle's posts, which are dated a month later — the prompt said September and showed
 * October, and the model reported the discrepancy it had been handed.
 *
 * These run the real `runPlanAgentTurn` against a pinned today (2026-07-29, the day of the
 * re-check) so the dates in them keep meaning what they meant on the phone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from './types';
import type { ParserContext } from './task-parser';

/** The client's real shape: an August cycle and a September cycle, both on record. */
const AUG_POSTS = [
  { id: 'p-aug-5',  cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date: '2026-08-05', format: 'reel',   pillar: 'Late summer', caption: 'Linen, one more time', status: 'planned', reviewState: null },
  { id: 'p-aug-12', cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date: '2026-08-12', format: 'single', pillar: 'Late summer', caption: 'The restock',           status: 'planned', reviewState: null },
];
const SEP_POSTS = [
  { id: 'p-sep-4',  cycleId: 'cyc-sep', clientId: 'c1', channel: 'instagram', date: '2026-09-04', format: 'reel',   pillar: 'Autumn', caption: 'Autumn layers',   status: 'planned', reviewState: null },
  { id: 'p-sep-18', cycleId: 'cyc-sep', clientId: 'c1', channel: 'instagram', date: '2026-09-18', format: 'single', pillar: 'Autumn', caption: 'The wool coat',   status: 'planned', reviewState: null },
];

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  postsByCycle: {} as Record<string, unknown[]>,
  /** Every parser context the turn built, so the PROMPT itself can be asserted on. */
  contexts: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async (_c: string, cycleId: string) => h.postsByCycle[cycleId] ?? [] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', () => ({
  parseTasks: async (_t: string, ctx: unknown) => { h.contexts.push(ctx); return h.tasks; },
}));
// The real cycle-state, but reading from the fixture instead of Postgres. `planMonthOf` is the
// production one: these cycle rows are stored by DATA month exactly as the table stores them.
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  const ROWS = [
    { id: 'cyc-aug', month: '2026-07', status: 'workbook_built' },   // plans AUGUST
    { id: 'cyc-sep', month: '2026-08', status: 'scheduled' },        // plans SEPTEMBER
  ];
  return {
    ...real,
    getClientCycleMonths: async (_c: string, viewed: string) => real.describeCycles(ROWS, viewed),
    getCycleMonth: async (_c: string, id: string) => {
      const row = ROWS.find((r) => r.id === id);
      return row ? real.planMonthOf(row.month) : null;
    },
  };
});
vi.mock('@/lib/agent/conversation', () => ({ ensureConversation: async () => 'conv-1', appendMessage: async () => 'msg-1' }));
vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => {
    h.createCalls.push(args);
    return { id: `pv-${h.createCalls.length}`, intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId };
  },
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: async () => 'answer' }));
// The day of the re-check. August 5th and September 4th are both still ahead of it, which is the
// only fact the editability rule is allowed to care about.
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayDate: () => new Date(2026, 6, 29) }));

import { runPlanAgentTurn } from './turn';

const ask = (cycleId: string, instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId, instruction, source: 'voice' });

const lastCtx = () => h.contexts[h.contexts.length - 1] as ParserContext;

beforeEach(() => {
  h.tasks = [];
  h.contexts.length = 0;
  h.createCalls.length = 0;
  h.postsByCycle = { 'cyc-aug': [...AUG_POSTS], 'cyc-sep': [...SEP_POSTS] };
});

describe('screenshot 1 — "August 5th is in a past workbook"', () => {
  it('an Aug-5 move asked from the AUGUST view succeeds', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-08-05', selector: 'the 5th', toDate: '2026-08-07', reason: 'move the 5th to the 7th' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the post on the 5th to the 7th');

    expect(r.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.action).toBe('move_post');
    expect(h.createCalls[0]!.payload).toMatchObject({ kind: 'move', cycleId: 'cyc-aug', postId: 'p-aug-5', toDate: '2026-08-07' });
  });

  it('and the refusal that was given is now unsayable — nothing in the turn calls August past', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-08-05', selector: 'the 5th', toDate: '2026-08-07' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the post on the 5th to the 7th');
    expect(r.message ?? '').not.toMatch(/past workbook|can only edit/i);
    // The old off-by-one guard fired on every in-month move. It cannot any more.
    expect(r.message ?? '').not.toMatch(/different month isn’t available/i);
  });

  it('the AUGUST view builds an AUGUST prompt — month, digest and marker all agree', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('cyc-aug', 'what have I got on');
    const ctx = lastCtx();

    expect(ctx.viewedMonth).toBe('August 2026');
    expect(ctx.planDigest).toContain('5 Aug');
    expect(ctx.planDigest).not.toContain('Sep');
    expect(ctx.cycleMonths).toMatch(/August 2026 .*\[the month on screen\]/);
    // September is still listed, so "push it into next month" has somewhere to land.
    expect(ctx.cycleMonths).toContain('September 2026');
  });

  it('a genuinely past date is still refused, and says so plainly', async () => {
    h.postsByCycle['cyc-aug'] = [{ ...AUG_POSTS[0]!, id: 'p-old', date: '2026-07-01' }];
    h.tasks = [{ action: 'move_post', fromDate: '2026-07-01', toDate: '2026-08-07' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the 1st of july to the 7th');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toContain('1 July');
    expect(r.message).toMatch(/already passed/);
  });

  it('and a move ONTO a past date is refused too, without blaming the post', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-08-05', toDate: '2026-07-20' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the 5th back to the 20th of july');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toContain('20 July');
    expect(r.message).toMatch(/already passed/);
  });
});

describe('screenshot 2 — "the plan digest shows posts starting October 1st"', () => {
  it('a Sep-4 reference from the SEPTEMBER view sees September’s posts', async () => {
    h.tasks = [{ action: 'rewrite_post', selector: 'the reel on the 4th', instruction: 'warmer' }] as ParsedTask[];
    const r = await ask('cyc-sep', 'make the reel on the 4th warmer');

    const ctx = lastCtx();
    expect(ctx.viewedMonth).toBe('September 2026');
    expect(ctx.planDigest).toContain('4 Sep');
    expect(ctx.planDigest).toContain('18 Sep');
    expect(ctx.planDigest).not.toContain('Oct');
    // …and the post actually resolves, which is the point of the digest.
    expect(r.proposals).toHaveLength(1);
    expect(h.createCalls[0]!.payload).toMatchObject({ postId: 'p-sep-4' });
  });

  it('THE CONTRADICTION: the month the prompt names is the month the digest holds', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('cyc-sep', 'anything');
    const ctx = lastCtx();
    // The whole defect in one assertion. The list used to say "August 2026 [current, editable]"
    // above a digest of September dates; the model read that back as the digest being a month off.
    expect(ctx.cycleMonths).toMatch(/September 2026 .*\[the month on screen\]/);
    expect(ctx.viewedMonth).toBe('September 2026');
    expect(ctx.planDigest).toContain('Sep');
  });

  it('no cycle is described as the only editable one', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('cyc-sep', 'anything');
    expect(lastCtx().cycleMonths).not.toMatch(/editable/i);
  });
});

describe('the same client, two months, one agent', () => {
  it('switching the viewed cycle switches the whole context with it', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('cyc-aug', 'anything');
    await ask('cyc-sep', 'anything');
    const [aug, sep] = h.contexts as ParserContext[];

    expect(aug!.viewedMonth).toBe('August 2026');
    expect(sep!.viewedMonth).toBe('September 2026');
    expect(aug!.planDigest).not.toBe(sep!.planDigest);
    // The list of months is the same both times — only the marker moves.
    expect(aug!.cycleMonths.replace(/ \[the month on screen\]/, ''))
      .toBe(sep!.cycleMonths.replace(/ \[the month on screen\]/, ''));
  });
});
