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
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async (_c: string, cycleId: string) => h.postsByCycle[cycleId] ?? [], loadDraftBeats: async () => [] }));
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
    // X1a: the context seam reads the client's cycles through this one function.
    listClientCycles: async () => ROWS,
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
  // C3: nothing pending in these fixtures — they test resolution, not amendment.
  loadPendingPayloads: async () => [],
  rejectProposal: async () => null,
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: async () => 'answer' }));
// The day of the re-check. August 5th and September 4th are both still ahead of it, which is the
// only fact the editability rule is allowed to care about. The turn now reads today through
// `editScopeToday()` (the write gate's own source), whose chain ends at `e2eTodayIso` — so the
// freeze goes in through the same door production's e2e freeze does.
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-07-29', e2eFakeEnabled: () => false }));

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

  /**
   * DELIBERATE CHANGE (X1a). This asserted `planDigest` did NOT contain 'Sep' — the digest was
   * one cycle's posts, and that single fact is what made August untouchable from October and
   * September unreachable from August. The digest is now the SPAN. What has to stay true is the
   * thing the assertion was really protecting: the prompt must not lose track of WHICH month is
   * on screen, because a bare "the 5th" resolves there. So the marker is asserted instead of the
   * absence, on both the month list and the digest's own headings.
   */
  it('the AUGUST view names August as the month on screen — and can still SEE September', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('cyc-aug', 'what have I got on');
    const ctx = lastCtx();

    expect(ctx.viewedMonth).toBe('August 2026');
    expect(ctx.planDigest).toContain('5 Aug');
    // The span: September's posts are IN the digest, under their own heading, and August's
    // heading is the one marked.
    expect(ctx.planDigest).toContain('4 Sep');
    expect(ctx.planDigest).toMatch(/August 2026 \(2026-08\) \[the month on screen\]/);
    expect(ctx.planDigest).toMatch(/September 2026 \(2026-09\):/);
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

/**
 * ── The interpretation, derived ──────────────────────────────────────────────────────
 *
 * `items` is what the client consents to, so what it is BUILT FROM is the whole of its honesty.
 * Every field below comes from the structured task the parser extracted plus the post row it
 * resolved to — never from a sentence the model wrote. These tests assert the derivation, not
 * the rendering: the words are the surface's job (`Interpretation.tsx`).
 */
describe('the interpretation is computed from resolved targets', () => {
  it('a move carries the post’s OWN title and both real dates', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-08-05', toDate: '2026-08-07', reason: 'shift the linen one' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the 5th to the 7th');

    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      kind: 'change', action: 'move',
      title: 'Linen, one more time',        // the post's title, resolved — not "the linen one"
      fromDate: '2026-08-05', toDate: '2026-08-07',
    });
    expect(r.items[0]).toHaveProperty('proposalId');
  });

  it('NOTHING in an item is the client’s phrasing or the model’s paraphrase', async () => {
    h.tasks = [{ action: 'move_post', fromDate: '2026-08-05', toDate: '2026-08-07', reason: 'shift the linen one' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'shift the linen one');
    const json = JSON.stringify(r.items);
    // `reason` is the transcript echo this rendering exists to replace. It must not ride along.
    expect(json).not.toContain('shift the linen one');
    expect(Object.keys(r.items[0] as object)).not.toContain('reason');
  });

  it('an add carries the extracted SUBJECT, which is structured intent, and the resolved date', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-08-21', format: 'reel', instruction: 'Atlas Cedar restock', reason: 'can we do something for the restock' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'add something for the restock');
    expect(r.items[0]).toMatchObject({ kind: 'change', action: 'add', title: 'Atlas Cedar restock', toDate: '2026-08-21', format: 'reel' });
  });

  it('TWO INTENTS → two items, in the order they were asked', async () => {
    h.tasks = [
      { action: 'move_post', fromDate: '2026-08-05', toDate: '2026-08-07' },
      { action: 'add_post', toDate: '2026-08-21', format: 'single', instruction: 'Atlas Cedar restock' },
    ] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the 5th to the 7th and add one for the restock');

    expect(r.items.map((i) => (i as { action?: string }).action)).toEqual(['move', 'add']);
    expect(r.proposals).toHaveLength(2);
    // Each line names the proposal it will apply, so per-item discard is a real operation.
    expect(new Set(r.items.map((i) => (i as { proposalId?: string }).proposalId)).size).toBe(2);
  });

  it('what could NOT be resolved becomes an unresolved item, beside what could', async () => {
    h.tasks = [
      { action: 'move_post', fromDate: '2026-08-05', toDate: '2026-08-07' },
      { action: 'rewrite_post', selector: 'the other one', reason: 'and warm up the other one' },
    ] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the 5th, and warm up the other one');

    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ kind: 'change' });
    expect(r.items[1]!.kind).toBe('unresolved');
    // One landed, one did not, and the client sees both. Only the first is applicable.
    expect(r.proposals).toHaveLength(1);
  });

  it('a note becomes an IDEA — filed, not placed, and nothing to apply', async () => {
    h.tasks = [{ action: 'add_note', content: 'the candle relaunch is coming' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'remember the candle relaunch is coming');

    expect(r.items).toEqual([{ kind: 'idea', text: 'the candle relaunch is coming' }]);
    expect(r.proposals).toHaveLength(0);
  });

  it('a genuinely past date is an unresolved item, so the refusal is IN the list', async () => {
    h.postsByCycle['cyc-aug'] = [{ ...AUG_POSTS[0]!, id: 'p-old', date: '2026-07-01' }];
    h.tasks = [{ action: 'move_post', fromDate: '2026-07-01', toDate: '2026-08-07' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the 1st of july');

    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: 'unresolved' });
    expect((r.items[0] as { question: string }).question).toContain('already passed');
  });

  it('a pure query produces no items — there is nothing to consent to', async () => {
    h.tasks = [{ action: 'query', question: 'what am I posting this week?' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'what am I posting this week?');
    expect(r.items).toEqual([]);
  });
});
