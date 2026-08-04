/**
 * turn-outcome.test.ts — a failed turn stops looking like a successful one (0092).
 *
 * `turn.ts` caught a thrown parse and wrote `metadata.tasks = ["clarify"]`; it caught a thrown
 * answerer and wrote `metadata.tasks = ["query"]`. Both byte-identical to their success case. So
 * every failure was recorded as a success and no count of how the agent is doing could be right.
 *
 * These assert the recorded ROW, through the real turn loop, by capturing what `appendMessage`
 * was handed. The point is that the distinctions are keys, so that is what is asserted — never
 * the prose, which is exactly the unstable thing this replaces.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from './types';

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  appended: [] as Array<Record<string, unknown>>,
  queryResult: { text: 'answer', outcome: 'answered' } as unknown,
  queryThrows: null as Error | null,
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', () => ({ parseTasks: async () => h.tasks }));
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  const ROWS = [{ id: 'cyc-aug', month: '2026-07', status: 'scheduled' }];
  return { ...real, listClientCycles: async () => ROWS, getCycleMonth: async () => '2026-08', resolveCycleForMonth: async () => 'cyc-aug' };
});
vi.mock('@/lib/agent/conversation', () => ({
  ensureConversation: async () => 'conv-1',
  appendMessage: async (a: Record<string, unknown>) => { h.appended.push(a); return 'msg-1'; },
  listTurns: async () => [], threadForParser: () => '', latestPendingIntent: () => null, intentForParser: () => '',
}));
vi.mock('@/lib/agent/proposals', () => ({ createProposal: async () => ({ id: 'pv-1' }), loadPendingPayloads: async () => [], rejectProposal: async () => null }));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => 'note-1' }));
// Partial: `answerQuery` is faked, but `readOutcomeTag` is the REAL one — the tag-stripping is
// what keeps the marker off the client's screen, so it must not be tested against a stub.
vi.mock('@/lib/agent/query', async (orig) => ({
  ...(await orig<typeof import('./query')>()),
  answerQuery: async () => { if (h.queryThrows) throw h.queryThrows; return h.queryResult; },
}));
vi.mock('@sprigly/audit', () => ({ createAuditLogger: () => ({ logModelCall: async () => undefined }) }));
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-08-04', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { readOutcomeTag } from './query';

const ask = (instruction = 'anything') =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'web' });

/** The ASSISTANT row — the one that carried the lie. */
const assistantRow = () => h.appended.find((a) => a['role'] === 'assistant')!;
const userRow = () => h.appended.find((a) => a['role'] === 'user')!;

beforeEach(() => {
  h.tasks = []; h.appended.length = 0;
  h.queryResult = { text: 'answer', outcome: 'answered' };
  h.queryThrows = null;
});

describe('every row says who wrote it', () => {
  it('the plan agent marks both of its rows', async () => {
    h.tasks = [{ action: 'query', question: 'what is on' }] as ParsedTask[];
    await ask();
    expect(userRow()).toMatchObject({ writer: 'plan-agent', outcome: 'user' });
    expect(assistantRow()).toMatchObject({ writer: 'plan-agent' });
  });

  it("a client's own message never claims an outcome", async () => {
    h.tasks = [{ action: 'query', question: 'q' }] as ParsedTask[];
    await ask();
    expect(userRow()['outcome']).toBe('user');
  });
});

describe('the four states the brief asked to distinguish', () => {
  it('ANSWERED — a query the model answered', async () => {
    h.tasks = [{ action: 'query', question: 'what is on next week' }] as ParsedTask[];
    await ask();
    expect(assistantRow()).toMatchObject({ outcome: 'answered', errorKind: null });
  });

  it('DECLINED — the model correctly said it does not have something', async () => {
    h.queryResult = { text: "I don't have that on file.", outcome: 'declined' };
    h.tasks = [{ action: 'query', question: 'what products are scheduled in September' }] as ParsedTask[];
    await ask();
    expect(assistantRow()).toMatchObject({ outcome: 'declined', errorKind: null });
  });

  it('ERRORED — a thrown answerQuery, which used to store as a successful query', async () => {
    h.queryThrows = Object.assign(new Error('boom'), { name: 'ThrottlingException' });
    h.tasks = [{ action: 'query', question: 'q' }] as ParsedTask[];
    await ask();
    expect(assistantRow()).toMatchObject({ outcome: 'errored', errorKind: 'answer-query:ThrottlingException' });
  });

  it('ERRORED — a parse failure, which used to store as a successful clarify', async () => {
    // What parseTasks synthesises when its own model call throws.
    h.tasks = [{ action: 'clarify', question: 'I couldn’t process that just now — send it again in a moment.', parseError: 'parse:ThrottlingException' }] as ParsedTask[];
    await ask();
    expect(assistantRow()).toMatchObject({ outcome: 'errored', errorKind: 'parse:ThrottlingException' });
  });

  it('and the two error rows are told apart by KEY, not by their copy', async () => {
    h.queryThrows = Object.assign(new Error('x'), { name: 'TimeoutError' });
    h.tasks = [{ action: 'query', question: 'q' }] as ParsedTask[];
    await ask();
    const a = assistantRow()['errorKind'];
    h.appended.length = 0; h.queryThrows = null;
    h.tasks = [{ action: 'clarify', question: 'q', parseError: 'parse:MalformedOutput' }] as ParsedTask[];
    await ask();
    expect(a).not.toBe(assistantRow()['errorKind']);
  });
});

describe('a failure is never masked by a cheerier outcome', () => {
  it('a turn that BOTH proposed a change and threw is errored', async () => {
    h.queryThrows = new Error('nope');
    h.tasks = [
      { action: 'add_post', instruction: 'a thing', toDate: '2026-08-20' },
      { action: 'query', question: 'and what is on' },
    ] as ParsedTask[];
    const r = await ask();
    expect(r.proposals.length).toBe(1);            // the change really did happen
    expect(assistantRow()['outcome']).toBe('errored');   // …and the row still says it broke
  });

  it('a clarify carrying a parseError outranks a successful sibling task', async () => {
    h.tasks = [
      { action: 'clarify', question: 'broke', parseError: 'parse:MalformedOutput' },
      { action: 'add_note', content: 'a note' },
    ] as ParsedTask[];
    await ask();
    expect(assistantRow()['outcome']).toBe('errored');
  });
});

describe('the non-error outcomes', () => {
  it('CHANGED — proposals were created', async () => {
    h.tasks = [{ action: 'add_post', instruction: 'x', toDate: '2026-08-20' }] as ParsedTask[];
    await ask();
    expect(assistantRow()['outcome']).toBe('changed');
  });

  it('NOTED — an idea was recorded', async () => {
    h.tasks = [{ action: 'add_note', content: 'the candle relaunch' }] as ParsedTask[];
    await ask();
    expect(assistantRow()['outcome']).toBe('noted');
  });

  it('CLARIFIED — a genuine clarify, with no parseError, is NOT an error', async () => {
    h.tasks = [{ action: 'clarify', question: 'Which post did you mean?' }] as ParsedTask[];
    await ask();
    expect(assistantRow()).toMatchObject({ outcome: 'clarified', errorKind: null });
  });

  it('UNKNOWN — an untagged answer is not promoted to answered', async () => {
    h.queryResult = { text: 'something', outcome: 'unknown' };
    h.tasks = [{ action: 'query', question: 'q' }] as ParsedTask[];
    await ask();
    expect(assistantRow()['outcome']).toBe('unknown');
  });
});

describe('errorKind and outcome cannot disagree (the CHECK constraint, in code)', () => {
  it('a non-error row never carries a kind', async () => {
    h.tasks = [{ action: 'add_note', content: 'x' }] as ParsedTask[];
    await ask();
    expect(assistantRow()['errorKind']).toBeNull();
  });

  it('an error row always carries one', async () => {
    h.queryThrows = new Error('x');
    h.tasks = [{ action: 'query', question: 'q' }] as ParsedTask[];
    await ask();
    expect(assistantRow()['errorKind']).toBeTruthy();
  });
});

describe('the outcome tag never reaches the client', () => {
  it('is stripped from the answer', () => {
    const r = readOutcomeTag('I don’t have that on file.\n\n[[outcome:declined]]');
    expect(r.text).toBe('I don’t have that on file.');
    expect(r.outcome).toBe('declined');
  });

  it('is stripped even when the model puts it inline or mis-cases it', () => {
    const r = readOutcomeTag('Here you go. [[OUTCOME:ANSWERED]] Anything else?');
    expect(r.text).not.toContain('outcome');
    expect(r.outcome).toBe('answered');
  });

  it('a missing tag is unknown, never answered', () => {
    expect(readOutcomeTag('Some answer with no tag.').outcome).toBe('unknown');
  });

  it('both tags resolves to declined — the part it could not answer is the part worth knowing', () => {
    expect(readOutcomeTag('a [[outcome:answered]] b [[outcome:declined]]').outcome).toBe('declined');
  });
});
