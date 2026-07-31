/**
 * cross-month.test.ts — X1, from the operator's live failures.
 *
 * Two sentences came off the phone, one month apart on the same surface:
 *
 *   AUGUST view    "moving posts to a different month isn't available yet"
 *                  — said to "Yes move it to September 24 next month"
 *   OCTOBER view   August simply unreachable: no reference to an August post resolved,
 *                  because August's posts were never loaded.
 *
 * Neither was a rule. The first was ONE guard in `turn.ts` comparing the destination's month
 * against the viewed cycle's; the second was the plan context being one `loadPlanPosts` call for
 * one cycle. Both are the same mistake in two places — treating the cycle the client happens to
 * be LOOKING at as the boundary of what they may CHANGE.
 *
 * Everything here runs the real `runPlanAgentTurn` against a pinned today (2026-07-31 — the day
 * of the operator's session, with October on screen), so the dates keep meaning what they meant.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from './types';
import type { ParserContext } from './task-parser';

const post = (id: string, cycleId: string, date: string, caption: string, format = 'single') =>
  ({ id, cycleId, clientId: 'c1', channel: 'instagram', date, format, pillar: 'Launch', caption, status: 'planned', reviewState: null });

/** The operator's client: four consecutive months on record. */
const AUG = [
  post('p-aug-3',  'cyc-aug', '2026-08-03', 'Linen, one more time'),
  post('p-aug-14', 'cyc-aug', '2026-08-14', 'Weekend style guide', 'carousel'),
  post('p-aug-20', 'cyc-aug', '2026-08-20', 'Atlas Cedar launch',  'reel'),
];
const SEP = [post('p-sep-4', 'cyc-sep', '2026-09-04', 'Autumn layers', 'reel')];
const OCT = [post('p-oct-8', 'cyc-oct', '2026-10-08', 'The wool coat')];
const NOV = [post('p-nov-2', 'cyc-nov', '2026-11-02', 'Party season')];

/** The launch arc fixture 2 moves: three posts, mid-August. */
const LAUNCH = [
  post('p-l1', 'cyc-aug', '2026-08-14', 'Oak tree tease',  'reel'),
  post('p-l2', 'cyc-aug', '2026-08-16', 'Oak tree launch', 'reel'),
  post('p-l3', 'cyc-aug', '2026-08-18', 'Oak tree in use', 'reel'),
];

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  postsByCycle: {} as Record<string, unknown[]>,
  rows: [] as Array<{ id: string; month: string; status: string }>,
  contexts: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
  pending: [] as Array<Record<string, unknown>>,
  rejected: [] as string[],
  /** Every user message the fake model was given — the query answerer's PLAN STATE included. */
  modelCalls: [] as string[],
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, conversations: {}, agentMessages: {} }));
vi.mock('@sprigly/audit', () => ({ createAuditLogger: () => ({ logModelCall: async () => undefined }) }));
vi.mock('@sprigly/knowledge', () => ({ retrieveChunks: async () => [] }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async (_c: string, cycleId: string) => h.postsByCycle[cycleId] ?? [] }));
// A REAL model client shape, so the query answerer actually runs and its prompt can be read.
vi.mock('@/lib/agent/model', () => ({
  getModelClient: () => ({
    complete: async (req: { messages: Array<{ content: unknown }> }) => {
      const c = req.messages[0]?.content;
      h.modelCalls.push(typeof c === 'string' ? c : JSON.stringify(c));
      return { content: 'ok', modelId: 'fake', inputTokens: 1, outputTokens: 1 };
    },
  }),
  getEmbeddingClient: () => ({}),
  AGENT_MODEL: 'fake',
}));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', () => ({
  parseTasks: async (_t: string, ctx: unknown) => { h.contexts.push(ctx); return h.tasks; },
}));
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  return {
    ...real,
    listClientCycles: async () => h.rows,
    getClientCycleMonths: async (_c: string, viewed: string) => real.describeCycles(h.rows, viewed),
    getCycleMonth: async (_c: string, id: string) => {
      const row = h.rows.find((r) => r.id === id);
      return row ? real.planMonthOf(row.month) : null;
    },
  };
});
vi.mock('@/lib/agent/conversation', () => ({
  ensureConversation: async () => 'conv-1', appendMessage: async () => 'msg-1',
  listTurns: async () => [], threadForParser: () => '', latestPendingIntent: () => null, intentForParser: () => '',
}));
vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => {
    h.createCalls.push(args);
    return { id: `pv-${h.createCalls.length}`, intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId };
  },
  loadPendingPayloads: async (_c: string, ids: readonly string[]) => h.pending.filter((p) => ids.includes(p.id as string)),
  rejectProposal: async (_c: string, id: string) => { h.rejected.push(id); return null; },
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));
// THE DAY OF THE SESSION: 31 July 2026, October on screen.
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-07-31', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { selectSpan, spanDigest } from './plan-context';

const ask = (cycleId: string, instruction: string, pendingProposalIds?: string[]) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId, instruction, source: 'voice', ...(pendingProposalIds ? { pendingProposalIds } : {}) });
const lastCtx = () => h.contexts[h.contexts.length - 1] as ParserContext;
const payloads = () => h.createCalls.map((c) => c.payload as Record<string, unknown>);

beforeEach(() => {
  h.tasks = [];
  h.contexts.length = 0;
  h.createCalls.length = 0;
  h.pending.length = 0;
  h.rejected.length = 0;
  h.modelCalls.length = 0;
  h.rows = [
    { id: 'cyc-aug', month: '2026-07', status: 'workbook_built' },   // plans AUGUST
    { id: 'cyc-sep', month: '2026-08', status: 'scheduled' },        // plans SEPTEMBER
    { id: 'cyc-oct', month: '2026-09', status: 'scheduled' },        // plans OCTOBER
    { id: 'cyc-nov', month: '2026-10', status: 'planning' },         // plans NOVEMBER
  ];
  h.postsByCycle = { 'cyc-aug': [...AUG], 'cyc-sep': [...SEP], 'cyc-oct': [...OCT], 'cyc-nov': [...NOV] };
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SPAN — the rule, as a pure function
// ─────────────────────────────────────────────────────────────────────────────
describe('the span: where they are standing, and where now is', () => {
  const ROWS = [
    { id: 'cyc-aug', month: '2026-07', status: 'a' },
    { id: 'cyc-sep', month: '2026-08', status: 'a' },
    { id: 'cyc-oct', month: '2026-09', status: 'a' },
    { id: 'cyc-nov', month: '2026-10', status: 'a' },
  ];

  it('the viewed cycle and its neighbours — rule 1', () => {
    // Standing in September in mid-September: Aug, Sep, Oct.
    const span = selectSpan(ROWS, 'cyc-sep', '2026-09-15');
    expect(span.map((c) => c.planMonth)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(span.find((c) => c.cycleId === 'cyc-sep')!.reason).toBe('viewed');
    expect(span.find((c) => c.cycleId === 'cyc-oct')!.reason).toBe('adjacent');
  });

  it('THE OPERATOR’S CASE: October on screen on 31 July still sees AUGUST — rule 2', () => {
    const span = selectSpan(ROWS, 'cyc-oct', '2026-07-31');
    expect(span.map((c) => c.planMonth)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    // August is not there as a neighbour of October. It is there because NEXT WEEK is in it.
    expect(span.find((c) => c.cycleId === 'cyc-aug')!.reason).toBe('now');
  });

  it('a week that straddles a month boundary pulls in both months', () => {
    // 30 September + 7 days = 7 October.
    const span = selectSpan(ROWS, 'cyc-aug', '2026-09-30');
    expect(span.map((c) => c.planMonth)).toContain('2026-09');
    expect(span.map((c) => c.planMonth)).toContain('2026-10');
  });

  it('it is bounded: never more than five months, and typically three', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, month: `2026-${String(i + 1).padStart(2, '0')}`, status: 'a' }));
    for (const row of many) {
      expect(selectSpan(many, row.id, '2026-07-31').length).toBeLessThanOrEqual(5);
    }
    // Mid-month, standing where you already are: exactly three.
    expect(selectSpan(many, 'c7', '2026-08-15')).toHaveLength(3);
  });

  it('an adjacent cycle is adjacent in the CLIENT’S month order, gaps and all', () => {
    const gapped = [
      { id: 'cyc-aug', month: '2026-07', status: 'a' },   // August
      { id: 'cyc-oct', month: '2026-09', status: 'a' },   // October — September missing
    ];
    const span = selectSpan(gapped, 'cyc-oct', '2026-10-15');
    expect(span.map((c) => c.cycleId)).toEqual(['cyc-aug', 'cyc-oct']);
  });

  it('a client with no cycles gets an empty span rather than a throw', () => {
    expect(selectSpan([], 'cyc-x', '2026-07-31')).toEqual([]);
  });
});

describe('the digest names every month in scope', () => {
  it('the window line lists all of them, and each month gets its own heading', () => {
    const cycles = [
      { cycleId: 'cyc-aug', planMonth: '2026-08', status: 'a', reason: 'now' as const, inDigest: true, posts: AUG as never },
      { cycleId: 'cyc-oct', planMonth: '2026-10', status: 'a', reason: 'viewed' as const, inDigest: true, posts: OCT as never },
    ];
    const d = spanDigest(cycles, '2026-07-31', 'cyc-oct');
    expect(d).toContain('2026-08-01 to 2026-08-31 (August 2026)');
    expect(d).toContain('2026-10-01 to 2026-10-31 (October 2026)');
    expect(d).toMatch(/October 2026 \(2026-10\) \[the month on screen\]/);
    expect(d).toMatch(/August 2026 \(2026-08\):/);
  });

  it('every row carries its ISO date, and past rows are marked by the WRITE GATE’S predicate', () => {
    const cycles = [{
      cycleId: 'cyc-aug', planMonth: '2026-08', status: 'a', reason: 'viewed' as const, inDigest: true,
      posts: [...AUG, post('p-old', 'cyc-aug', '2026-07-20', 'Gone')] as never,
    }];
    const rows = spanDigest(cycles, '2026-07-31', 'cyc-aug').split('\n');
    expect(rows.find((l) => l.includes('2026-07-20'))).toContain('[past — read-only]');
    expect(rows.find((l) => l.includes('2026-08-03'))).not.toContain('past');
    // 31 July is today, and today is not past — the gate's rule, not a re-derivation.
    expect(rows.find((l) => l.includes('2026-08-03'))).toContain('2026-08-03');
  });

  it('a month in scope with no posts says so rather than vanishing', () => {
    const cycles = [{ cycleId: 'cyc-nov', planMonth: '2026-11', status: 'a', reason: 'adjacent' as const, inDigest: true, posts: [] as never }];
    expect(spanDigest(cycles, '2026-07-31', 'cyc-oct')).toContain('(no posts in this month yet)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 1 — "Yes move it to September 24 next month", asked from August
// ─────────────────────────────────────────────────────────────────────────────
describe('fixture 1 — the sentence that was refused', () => {
  beforeEach(() => {
    h.tasks = [{
      action: 'move_post', postId: 'p-aug-20', selector: 'the Atlas Cedar launch',
      fromDate: '2026-08-20', toDate: '2026-09-24', reason: 'move it to September 24 next month',
    }] as ParsedTask[];
  });

  it('it resolves and proposes, from the AUGUST view', async () => {
    const r = await ask('cyc-aug', 'Yes move it to September 24 next month');
    expect(r.proposals).toHaveLength(1);
    expect(payloads()[0]).toMatchObject({ kind: 'move', postId: 'p-aug-20', toDate: '2026-09-24' });
  });

  it('THE REFUSAL IS UNSAYABLE — nothing in the turn mentions a different month being unavailable', async () => {
    const r = await ask('cyc-aug', 'Yes move it to September 24 next month');
    expect(r.message ?? '').not.toMatch(/different month/i);
    expect(r.message ?? '').not.toMatch(/isn’t available|isn't available/i);
    expect(r.items.some((i) => i.kind === 'unresolved')).toBe(false);
  });

  it('the interpretation shows BOTH resolved dates, so the cross-month hop is visible before it applies', async () => {
    const r = await ask('cyc-aug', 'Yes move it to September 24 next month');
    expect(r.items[0]).toMatchObject({ kind: 'change', action: 'move', fromDate: '2026-08-20', toDate: '2026-09-24' });
  });

  it('the proposal is scoped to the POST’S OWN cycle, not the one on screen', async () => {
    await ask('cyc-oct', 'Yes move it to September 24 next month');   // asked from OCTOBER this time
    expect(payloads()[0]).toMatchObject({ cycleId: 'cyc-aug', postId: 'p-aug-20' });
  });

  it('a destination month with NO cycle is refused honestly, and never invents one', async () => {
    h.tasks = [{ action: 'move_post', postId: 'p-aug-20', fromDate: '2026-08-20', toDate: '2027-03-04' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move it to the 4th of March');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toContain('March 2027');
    expect(r.message).toMatch(/no March 2027 plan yet/);
  });

  it('the DATE rule still bites, in either month', async () => {
    h.tasks = [{ action: 'move_post', postId: 'p-aug-20', fromDate: '2026-08-20', toDate: '2026-07-15' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move it back to the 15th of july');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toMatch(/15 July.*already passed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 2 — the launch sequence, and the correction
// ─────────────────────────────────────────────────────────────────────────────
describe('fixture 2 — "forward by 12 days", then "no, forward brings it earlier"', () => {
  beforeEach(() => { h.postsByCycle['cyc-aug'] = [...LAUNCH]; });

  const moves = (pairs: Array<[string, string, string]>) =>
    pairs.map(([postId, fromDate, toDate]) => ({ action: 'move_post', postId, fromDate, toDate, reason: 'the launch sequence' })) as ParsedTask[];

  it('turn 1 — the whole arc moves forward by 12 days, all inside August', async () => {
    h.tasks = moves([['p-l1', '2026-08-14', '2026-08-26'], ['p-l2', '2026-08-16', '2026-08-28'], ['p-l3', '2026-08-18', '2026-08-30']]);
    const r = await ask('cyc-aug', 'Move the whole launch sequence forward by 12 days');
    expect(r.proposals).toHaveLength(3);
    expect(payloads().map((p) => p.toDate)).toEqual(['2026-08-26', '2026-08-28', '2026-08-30']);
    expect(r.message ?? '').not.toMatch(/different month/i);
  });

  it('turn 2 — the correction SUPERSEDES the three, and lands 12 days the other way, still in August', async () => {
    h.pending = [
      { id: 'pv-1', intent: 'move_post', summary: 'Move …', payload: { kind: 'move', cycleId: 'cyc-aug', postId: 'p-l1', toDate: '2026-08-26' } },
      { id: 'pv-2', intent: 'move_post', summary: 'Move …', payload: { kind: 'move', cycleId: 'cyc-aug', postId: 'p-l2', toDate: '2026-08-28' } },
      { id: 'pv-3', intent: 'move_post', summary: 'Move …', payload: { kind: 'move', cycleId: 'cyc-aug', postId: 'p-l3', toDate: '2026-08-30' } },
    ];
    h.tasks = moves([['p-l1', '2026-08-14', '2026-08-02'], ['p-l2', '2026-08-16', '2026-08-04'], ['p-l3', '2026-08-18', '2026-08-06']])
      .map((t) => ({ ...t, amends: true, reason: 'moving it forward brings it earlier in August' }));

    const r = await ask('cyc-aug', 'No, moving it forward brings it earlier in August', ['pv-1', 'pv-2', 'pv-3']);

    // The three the client was looking at are gone — not standing beside the corrected ones.
    expect(h.rejected).toEqual(['pv-1', 'pv-2', 'pv-3']);
    expect(r.supersededProposalIds).toEqual(['pv-1', 'pv-2', 'pv-3']);
    // And the corrected arc applies WITHIN August.
    expect(payloads().map((p) => p.toDate)).toEqual(['2026-08-02', '2026-08-04', '2026-08-06']);
    expect(payloads().every((p) => p.cycleId === 'cyc-aug')).toBe(true);
    expect(r.message ?? '').not.toMatch(/different month|already passed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 3 — "what's happening next week", 31 July, October on screen
// ─────────────────────────────────────────────────────────────────────────────
describe('fixture 3 — a date question is about the date, not the month on screen', () => {
  it('the query answerer is given EVERY month in scope, and next week’s posts are in it', async () => {
    h.postsByCycle['cyc-aug'] = [...AUG, post('p-aug-5', 'cyc-aug', '2026-08-05', 'Next week’s reel', 'reel')];
    h.tasks = [{ action: 'query', question: 'What’s happening next week?' }] as ParsedTask[];
    await ask('cyc-oct', 'what’s happening next week');

    const planState = h.modelCalls.find((m) => m.includes('PLAN STATE'))!;
    expect(planState).toBeTruthy();
    // Next week from 31 July is 3–9 August. The post is there, from a cycle that is NOT the one
    // on screen — which is the whole of this fixture.
    expect(planState).toContain('2026-08-05');
    expect(planState).toContain('Next week’s reel');
    // TODAY is stated, so "next week" is arithmetic the model reads rather than guesses.
    expect(planState).toContain('TODAY IS 2026-07-31');
  });

  it('and when it CANNOT see the week, it names the months it can', async () => {
    // Only November on record: nothing covers next week, and nothing may pretend to.
    h.rows = [{ id: 'cyc-nov', month: '2026-10', status: 'planning' }];
    h.postsByCycle = { 'cyc-nov': [...NOV] };
    h.tasks = [{ action: 'query', question: 'What’s happening next week?' }] as ParsedTask[];
    await ask('cyc-nov', 'what’s happening next week');

    const planState = h.modelCalls.find((m) => m.includes('PLAN STATE'))!;
    expect(planState).toContain('2026-11-01 to 2026-11-30 (November 2026)');
    /**
     * DELIBERATE CHANGE (F1). This asserted the state contained no '2026-08' at all. It now
     * names next week's dates — 2026-08-03 to 2026-08-09 — and that is the improvement, not a
     * regression: the answerer can only say "next week is the 3rd to the 9th and I can't see it,
     * here is what I can" if it has been told which dates those are. What must still be absent
     * is any August POST, because none was loaded.
     */
    expect(planState).toContain('NEXT WEEK is 2026-08-03 to 2026-08-09');
    expect(planState).toContain('NEXT WEEK holds: 0 posts');
    expect(planState.split('\n').filter((l) => l.trim().startsWith('- 2026-08'))).toEqual([]);
  });

  it('the system prompt forbids answering "nothing planned" for a week it cannot see', async () => {
    const { QUERY_SYSTEM_PROMPT } = await import('./query');
    expect(QUERY_SYSTEM_PROMPT).toMatch(/NAME THE MONTHS YOU CAN SEE/);
    expect(QUERY_SYSTEM_PROMPT).toMatch(/never answer "nothing is planned" for a week you cannot see/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE 4 — an August edit, from the October view
// ─────────────────────────────────────────────────────────────────────────────
describe('fixture 4 — August is reachable from October', () => {
  it('the October view’s digest holds August’s posts', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('cyc-oct', 'anything');
    const ctx = lastCtx();
    expect(ctx.viewedMonth).toBe('October 2026');
    expect(ctx.planDigest).toContain('p-aug-14');
    expect(ctx.planDigest).toMatch(/October 2026 \(2026-10\) \[the month on screen\]/);
  });

  it('a rewrite of the 14 August post resolves and proposes against AUGUST’S cycle', async () => {
    h.tasks = [{ action: 'rewrite_post', postId: 'p-aug-14', selector: 'the weekend style guide', instruction: 'warmer' }] as ParsedTask[];
    const r = await ask('cyc-oct', 'make the 14 August one warmer');
    expect(r.proposals).toHaveLength(1);
    expect(payloads()[0]).toMatchObject({ kind: 'rewrite', cycleId: 'cyc-aug', postId: 'p-aug-14' });
  });

  it('a delete and a format change route to the post’s own cycle too', async () => {
    h.tasks = [
      { action: 'delete_post', postId: 'p-aug-3' },
      { action: 'change_format', postId: 'p-sep-4', format: 'carousel' },
    ] as ParsedTask[];
    await ask('cyc-oct', 'remove the 3rd and make the 4th September a carousel');
    expect(payloads()[0]).toMatchObject({ kind: 'delete', cycleId: 'cyc-aug' });
    expect(payloads()[1]).toMatchObject({ kind: 'format', cycleId: 'cyc-sep' });
  });

  /**
   * DELIBERATE CHANGE (F2). The digest and the resolution set are no longer the same list, so
   * this asserts what the month list now has to say: a month whose posts are not PRINTED is
   * still a month whose posts are LOADED, and the marker must invite a reference into it rather
   * than read as a boundary. Standing in November on 31 July, the span prints October and
   * November (and August, which holds next week); September is loaded and not printed.
   */
  it('the month list says an unprinted month can still be referenced — not that it is absent', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('cyc-nov', 'anything');
    const list = lastCtx().cycleMonths;
    expect(list).toMatch(/November 2026 .*\[the month on screen\] \[posts listed below\]/);
    expect(list).toMatch(/September 2026 .*posts not listed below — name a date or a title and I WILL find the post/);
    expect(list).not.toMatch(/September 2026 .*\[posts listed below\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// X1c — an add in another month
// ─────────────────────────────────────────────────────────────────────────────
describe('X1c — "add a post about X on 4 September", asked from August', () => {
  it('it lands in SEPTEMBER’s cycle, not the one on screen', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-09-04', format: 'reel', instruction: 'The Atlas Cedar drop.' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'add a reel about the Atlas Cedar drop on 4 September');
    expect(r.proposals).toHaveLength(1);
    expect(payloads()[0]).toMatchObject({ kind: 'add', cycleId: 'cyc-sep', date: '2026-09-04', format: 'reel' });
  });

  it('a month with NO cycle is refused honestly, and NEVER invents a cycle', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2027-03-04', instruction: 'Spring drop.' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'add a post about the spring drop on 4 March');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toContain('March 2027');
    expect(r.message).toMatch(/that’s a planning run, not an edit/);
    expect(r.items[0]).toMatchObject({ kind: 'unresolved' });
  });

  it('an UNDATED add is placed in the month on screen, from THAT month’s posts alone', async () => {
    // The span holds four months. If the default read across all of them it would land in
    // November; it must land in October, two days after October's own last post.
    h.tasks = [{ action: 'add_post', instruction: 'Something new.' }] as ParsedTask[];
    await ask('cyc-oct', 'add a post about something new');
    expect(payloads()[0]).toMatchObject({ cycleId: 'cyc-oct', date: '2026-10-10' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F2 — CROSS-MONTH IS TWO-WAY
//
// Live, from the AUGUST view: *"move the post on the 16th of October to the 19th"* came back
// **"October is not in your current plan view"** — a sentence nothing in this codebase writes,
// so the model composed it, and it composed it from what it was handed. X1b fixed the
// DESTINATION guard; the candidate set was still the SPAN, and the span from August does not
// reach October. `plan-context.ts` loaded `span.map(loadPlanPosts)` and `turn.ts` handed exactly
// that to `resolveMoveSource`, so there was no October post to find.
//
// The reverse worked, which is what made it read as arbitrary: from October the span reaches
// August through the now-rule, because next week is in it.
// ─────────────────────────────────────────────────────────────────────────────
describe('F2 — the operator’s sentence, from the August view', () => {
  const OCT_16 = post('p-oct-16', 'cyc-oct', '2026-10-16', 'Bonfire kit', 'carousel');

  beforeEach(() => { h.postsByCycle['cyc-oct'] = [...OCT, OCT_16]; });

  it('"move the post on the 16th of October to the 19th" resolves and proposes', async () => {
    h.tasks = [{
      action: 'move_post', selector: 'the post on the 16th of October',
      fromDate: '2026-10-16', toDate: '2026-10-19', reason: 'move the post on the 16th of October to the 19th',
    }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the post on the 16th of October to the 19th');

    expect(r.proposals).toHaveLength(1);
    expect(payloads()[0]).toMatchObject({ kind: 'move', cycleId: 'cyc-oct', postId: 'p-oct-16', toDate: '2026-10-19' });
    expect(r.message ?? '').not.toMatch(/current plan view|couldn’t find|not in your/i);
  });

  it('and it resolves on the SELECTOR alone, when the parser sends no fromDate', async () => {
    h.tasks = [{
      action: 'move_post', selector: 'the post on the 16th of October', toDate: '2026-10-19',
    }] as ParsedTask[];
    const r = await ask('cyc-aug', 'move the post on the 16th of October to the 19th');
    expect(payloads()[0]).toMatchObject({ postId: 'p-oct-16' });
    expect(r.proposals).toHaveLength(1);
  });

  it('BOTH DIRECTIONS, from the same client, on the same day', async () => {
    // October → from August (the reported failure)…
    h.tasks = [{ action: 'rewrite_post', selector: 'the Bonfire kit post', instruction: 'warmer' }] as ParsedTask[];
    await ask('cyc-aug', 'make the bonfire kit one warmer');
    expect(payloads()[0]).toMatchObject({ cycleId: 'cyc-oct', postId: 'p-oct-16' });

    // …and August → from October (the direction that already worked).
    h.createCalls.length = 0;
    h.tasks = [{ action: 'rewrite_post', postId: 'p-aug-14', instruction: 'warmer' }] as ParsedTask[];
    await ask('cyc-oct', 'make the 14 August one warmer');
    expect(payloads()[0]).toMatchObject({ cycleId: 'cyc-aug', postId: 'p-aug-14' });
  });

  it('A REFERENCE BY TITLE, two months away, from the August view', async () => {
    h.tasks = [{ action: 'delete_post', selector: 'the Party season post' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'drop the party season post');
    // November is two months past the span's far edge from August.
    expect(payloads()[0]).toMatchObject({ kind: 'delete', cycleId: 'cyc-nov', postId: 'p-nov-2' });
    expect(r.items[0]).toMatchObject({ kind: 'change', action: 'remove' });
  });

  it('the resolution set is WIDER than the digest — that is the point, and it is stated', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('cyc-aug', 'anything');
    const digest = lastCtx().planDigest;
    // October is loaded and reachable, and deliberately NOT printed: the digest costs tokens.
    expect(digest).not.toContain('p-oct-16');
    expect(lastCtx().cycleMonths).toMatch(/October 2026 .*name a date or a title/);
  });
});

describe('F2 — the month on screen still gets first refusal', () => {
  beforeEach(() => {
    // The 16th exists in THREE months. Before F2 the candidate set was one month, so this was
    // unambiguous by accident; now it has to be unambiguous by rule.
    h.postsByCycle['cyc-aug'] = [post('p-aug-16', 'cyc-aug', '2026-08-16', 'August sixteenth')];
    h.postsByCycle['cyc-sep'] = [post('p-sep-16', 'cyc-sep', '2026-09-16', 'September sixteenth')];
    h.postsByCycle['cyc-oct'] = [post('p-oct-16', 'cyc-oct', '2026-10-16', 'October sixteenth')];
  });

  it('a bare "the 16th" from August means AUGUST’S, not an ambiguity across three months', async () => {
    h.tasks = [{ action: 'rewrite_post', selector: 'the post on the 16th', instruction: 'warmer' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'make the 16th warmer');
    expect(r.proposals).toHaveLength(1);
    expect(payloads()[0]).toMatchObject({ postId: 'p-aug-16' });
  });

  it('and the same phrase from September means SEPTEMBER’S', async () => {
    h.tasks = [{ action: 'rewrite_post', selector: 'the post on the 16th', instruction: 'warmer' }] as ParsedTask[];
    await ask('cyc-sep', 'make the 16th warmer');
    expect(payloads()[0]).toMatchObject({ postId: 'p-sep-16' });
  });

  it('naming the month overrides the month on screen', async () => {
    h.tasks = [{ action: 'rewrite_post', selector: 'the post on the 16th of October', instruction: 'warmer' }] as ParsedTask[];
    await ask('cyc-aug', 'make the 16th of October warmer');
    expect(payloads()[0]).toMatchObject({ postId: 'p-oct-16' });
  });

  it('a genuinely ambiguous cross-month reference still ASKS rather than guessing', async () => {
    // Two posts in the same month, same day — the month on screen answers with two, so it asks.
    h.postsByCycle['cyc-aug'] = [
      post('p-aug-16a', 'cyc-aug', '2026-08-16', 'The first one'),
      post('p-aug-16b', 'cyc-aug', '2026-08-16', 'The second one'),
    ];
    h.tasks = [{ action: 'delete_post', selector: 'the post on the 16th' }] as ParsedTask[];
    const r = await ask('cyc-aug', 'remove the 16th');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toContain('There are 2 posts');
    expect(r.message).toContain('The first one');
  });
});
