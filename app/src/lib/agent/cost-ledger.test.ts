/**
 * cost-ledger.test.ts — RECONCILIATION. A sheet session's turns and its ledger rows must agree.
 *
 * The failure this exists to prevent is not a wrong number, it is a MISSING ROW. Every call site
 * on this path logs behind an `if (audit && ...)` guard, which means forgetting to pass the
 * auditor is silent: the feature works, the client sees their answer, and the spend simply never
 * appears. That is precisely how the conversational path came to be the largest unmeasured cost
 * in the product while every unit test stayed green.
 *
 * So this test counts. It drives N real turns through `runPlanAgentTurn` with the model faked and
 * the DATABASE faked but the LEDGER REAL — the actual `DrizzleAuditLogger` and the actual
 * `computeCostPence` run, writing through a recording `db.insert` — and asserts:
 *
 *   · exactly N parse rows for N turns (one call, one row — never zero, never two)
 *   · one answer row AND one embed row per query turn, and neither for turns that asked nothing
 *   · ledger rows and agent_messages agree: 2N messages (user + assistant) to N parse rows
 *   · costs are sub-penny reals, not the pre-0091 ceil-to-1p
 *
 * A query turn is the interesting case: it spends THREE times (parse, embed, answer) and must
 * produce three rows. That used to be asserted here as a shortfall — two rows for three calls —
 * and the assertion has been flipped now the embed write has landed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlanPost } from '../types';

const P = (id: string, date: string, caption: string): PlanPost => ({
  id, cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date,
  format: 'single', pillar: 'Style', caption, status: 'planned', reviewState: null, steps: [],
} as never);

/** A Bedrock cross-region haiku id, so the REAL price map prices it as the real thing. */
const HAIKU = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

interface LedgerRow {
  clientId: string; action: string; modelId: string | null;
  inputTokens: number | null; outputTokens: number | null;
  costPence: string | null; metadata: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  /** Everything the audit logger inserted — this IS the ledger under test. */
  ledger: [] as Array<Record<string, unknown>>,
  /** Everything appendMessage persisted — the agent_messages stand-in. */
  messages: [] as Array<{ role: string; content: string }>,
  posts: [] as unknown[],
  /** Canned model replies, consumed in call order; each carries its own token counts. */
  replies: [] as Array<{ content: string; inputTokens: number; outputTokens: number }>,
  modelCalls: [] as Array<{ system?: string | undefined }>,
  /** Titan embed calls — counted so "it happened" and "it was billed" stay separate claims. */
  embeds: 0,
  /** Whether the fake embedder reports usage. False exercises retrieveChunks' fallback, where
   *  no honest token count exists and the correct outcome is no row at all. */
  usageCapable: true,
}));

// The database, faked down to the one operation the ledger performs. `insert().values()` is
// recorded rather than executed; nothing else on this path touches `db` (every other collaborator
// is stubbed below), so an insert arriving here came from the audit logger.
vi.mock('@sprigly/db', () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => { h.ledger.push(row); return Promise.resolve(); },
    }),
  },
  auditLog: { __table: 'audit_log' },
  contentCycles: {}, contentCyclePosts: {}, conversations: {}, agentMessages: {},
  // `retrieveChunks` runs for REAL below rather than being stubbed out, so its two db
  // collaborators are faked here instead: the vector query returns no rows (a sparse knowledge
  // bank, which is the common case and exercises the same embed path).
  sql: { begin: async () => [] as unknown[] },
  serializeVector: (v: number[]) => `[${v.join(',')}]`,
}));

vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [...h.posts] }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- Maebelle (dress) — navy, cream' }));
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-08-01', e2eFakeEnabled: () => false }));

// The model, faked — but `parseTasks` and `answerQuery` themselves are REAL, so the audit writes
// under test are the real ones, reached through the real control flow.
vi.mock('@/lib/agent/model', () => ({
  // AGENT_MODEL must be re-exported: `task-parser` imports it from this module, and a mock that
  // drops it makes the parse throw before the model is ever called — which the parser then
  // degrades into a clarify, silently, exactly like a Bedrock outage.
  AGENT_MODEL: 'haiku',
  getModelClient: () => ({
    async complete(params: { system?: string }) {
      h.modelCalls.push({ system: params.system });
      const next = h.replies.shift() ?? { content: '{"tasks":[]}', inputTokens: 0, outputTokens: 0 };
      return { ...next, modelId: HAIKU, stopReason: 'end_turn' };
    },
    async completeStreaming() { throw new Error('not used'); },
  }),
  // Reports usage, as the real BedrockTitanClient does. A fake that returned only a vector would
  // silently take retrieveChunks down its no-row fallback, and this test would then pass while
  // measuring nothing — which is why `usageCapable` makes that path an explicit case instead.
  getEmbeddingClient: () => ({
    async embed() { h.embeds++; return new Array(1024).fill(0); },
    ...(h.usageCapable ? {
      async embedWithUsage() {
        h.embeds++;
        return { embedding: new Array(1024).fill(0), inputTokens: 60, modelId: 'amazon.titan-embed-text-v2:0' };
      },
    } : {}),
    async embedBatch() { h.embeds++; return []; },
    dimensions: 1024,
  }),
}));

// NOTE: @sprigly/knowledge is deliberately NOT mocked. `retrieveChunks` is where the embed
// billing lives, so stubbing it would leave this test asserting its own stub. Only its database
// collaborators are faked (see the @sprigly/db mock above).

vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  const ROWS = [{ id: 'cyc-aug', month: '2026-07', status: 'workbook_built' }];
  return {
    ...real,
    getClientCycleMonths: async (_c: string, viewed: string) => real.describeCycles(ROWS, viewed),
    getCycleMonth: async () => real.planMonthOf('2026-07'),
    readCycleState: async () => ({ summary: 'TODAY IS 2026-08-01\n(no posts)', thisWeek: [], nextWeek: [], counts: {} }),
  };
});

vi.mock('@/lib/agent/conversation', async (orig) => {
  const real = await orig<typeof import('./conversation')>();
  return {
    ...real,
    ensureConversation: async (_c: string, _cy: string | null, id?: string) => id ?? 'conv-1',
    listTurns: async () => [],
    appendMessage: async (a: { role: string; content: string }) => {
      h.messages.push({ role: a.role, content: a.content });
      return `m${h.messages.length}`;
    },
  };
});

vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => ({
    id: 'pv-1', intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId,
  }),
  loadPendingPayloads: async () => [],
  rejectProposal: async () => null,
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));

import { runPlanAgentTurn } from './turn';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice', conversationId: 'conv-1' });

const rows = (): LedgerRow[] => h.ledger as unknown as LedgerRow[];
const rowsFor = (action: string) => rows().filter((r) => r.action === action);

/** A parse reply that yields one clarify task — cheapest possible turn, still a full one. */
const CLARIFY = { content: '{"tasks":[{"action":"clarify","question":"ok"}]}', inputTokens: 4_500, outputTokens: 40 };
/** A parse reply that yields a query task, which makes the turn spend a SECOND time. */
const QUERY  = { content: '{"tasks":[{"action":"query","question":"What is scheduled this week?"}]}', inputTokens: 4_600, outputTokens: 55 };
/** The answerer's own reply, consumed by the query task's call. */
const ANSWER = { content: 'Two posts this week.', inputTokens: 900, outputTokens: 30 };

beforeEach(() => {
  h.ledger.length = 0;
  h.messages.length = 0;
  h.modelCalls.length = 0;
  h.replies.length = 0;
  h.embeds = 0;
  h.usageCapable = true;
  h.posts = [P('p-a', '2026-08-03', 'Linen, one more time')];
});

describe('N turns produce exactly N parse rows', () => {
  it('one row per turn across a scripted five-turn session', async () => {
    const N = 5;
    for (let i = 0; i < N; i++) h.replies.push({ ...CLARIFY });

    for (let i = 0; i < N; i++) await ask(`turn ${i + 1}`);

    expect(rowsFor('plan-agent:parse-tasks')).toHaveLength(N);
    expect(rows()).toHaveLength(N);                        // nothing else spent, nothing else logged
  });

  it('the ledger and agent_messages agree — 2N messages to N parse rows', async () => {
    const N = 4;
    for (let i = 0; i < N; i++) h.replies.push({ ...CLARIFY });

    for (let i = 0; i < N; i++) await ask(`turn ${i + 1}`);

    expect(h.messages).toHaveLength(2 * N);                            // user + assistant per turn
    expect(h.messages.filter((m) => m.role === 'user')).toHaveLength(N);
    expect(rowsFor('plan-agent:parse-tasks')).toHaveLength(h.messages.filter((m) => m.role === 'user').length);
  });

  it('every row is attributed to the client and names the model that spent', async () => {
    h.replies.push({ ...CLARIFY });
    await ask('one turn');

    const [row] = rowsFor('plan-agent:parse-tasks');
    expect(row!.clientId).toBe('c1');
    expect(row!.modelId).toBe(HAIKU);
    expect(row!.inputTokens).toBe(CLARIFY.inputTokens);
    expect(row!.outputTokens).toBe(CLARIFY.outputTokens);
  });
});

describe('a query turn spends three times and says so', () => {
  it('adds an answer row AND an embed row alongside the parse row', async () => {
    h.replies.push({ ...QUERY }, { ...ANSWER });
    await ask('what is scheduled this week?');

    expect(rowsFor('plan-agent:parse-tasks')).toHaveLength(1);
    expect(rowsFor('plan-agent:answer-query')).toHaveLength(1);
    expect(rowsFor('plan-agent:query-embed')).toHaveLength(1);
    expect(rowsFor('plan-agent:answer-query')[0]!.inputTokens).toBe(ANSWER.inputTokens);
  });

  it('the embed row names Titan and carries its real token count', async () => {
    h.replies.push({ ...QUERY }, { ...ANSWER });
    await ask('what is scheduled this week?');

    const embed = rowsFor('plan-agent:query-embed')[0]!;
    expect(embed.modelId).toBe('amazon.titan-embed-text-v2:0');
    expect(embed.inputTokens).toBe(60);        // what the client reported, not an estimate
    expect(embed.outputTokens).toBe(0);        // an embedding returns a vector, not tokens
    expect(embed.clientId).toBe('c1');
  });

  it('a mixed session reconciles per turn — 3 turns, 1 of them a query, 5 rows', async () => {
    h.replies.push({ ...CLARIFY }, { ...QUERY }, { ...ANSWER }, { ...CLARIFY });

    await ask('move something');
    await ask('what is scheduled this week?');
    await ask('and another thing');

    expect(rowsFor('plan-agent:parse-tasks')).toHaveLength(3);
    expect(rowsFor('plan-agent:answer-query')).toHaveLength(1);
    expect(rowsFor('plan-agent:query-embed')).toHaveLength(1);
    expect(rows()).toHaveLength(5);
    expect(h.messages).toHaveLength(6);
  });

  it('a turn that asks nothing writes neither an answer nor an embed row', async () => {
    h.replies.push({ ...CLARIFY });
    await ask('move something');
    expect(rowsFor('plan-agent:answer-query')).toHaveLength(0);
    expect(rowsFor('plan-agent:query-embed')).toHaveLength(0);
  });
});

describe('the costs on those rows are honest (migration 0091)', () => {
  it('a parse turn posts a FRACTION of a penny, not a whole one', async () => {
    h.replies.push({ ...CLARIFY });
    await ask('one turn');

    const cost = Number(rowsFor('plan-agent:parse-tasks')[0]!.costPence);
    expect(cost).toBeGreaterThan(0);      // never a fake 0
    expect(cost).toBeLessThan(1);         // Math.ceil posted 1p here before 0091
  });

  it('stores six decimal places, so a session total is exact rather than inflated', async () => {
    const N = 10;
    for (let i = 0; i < N; i++) h.replies.push({ ...CLARIFY });
    for (let i = 0; i < N; i++) await ask(`turn ${i + 1}`);

    const stored = rows().map((r) => String(r.costPence));
    for (const s of stored) expect(s).toMatch(/^\d+\.\d{6}$/);

    // Ten cheap turns cost well under ten pence. Under the old ceil they cost exactly 10p —
    // which is the overstatement this whole change exists to remove.
    const total = stored.reduce((a, s) => a + Number(s), 0);
    expect(total).toBeLessThan(N);
  });

  it('a cheaper call costs strictly less than a dearer one — the ledger can rank turns', async () => {
    h.replies.push({ ...QUERY }, { ...ANSWER });
    await ask('what is scheduled this week?');

    const parse  = Number(rowsFor('plan-agent:parse-tasks')[0]!.costPence);
    const answer = Number(rowsFor('plan-agent:answer-query')[0]!.costPence);
    expect(answer).toBeLessThan(parse);   // 900 in vs 4,600 in — both were 1p before 0091
  });
});

describe('what the row carries for diagnosis', () => {
  it('records the shape of the turn, not its content', async () => {
    h.replies.push({ ...CLARIFY });
    await ask('one turn');

    const meta = rowsFor('plan-agent:parse-tasks')[0]!.metadata;
    expect(meta).toMatchObject({ viewedMonth: 'August 2026', hasPending: false });
    expect(typeof meta.digestChars).toBe('number');
    expect(typeof meta.catalogueChars).toBe('number');
    // The client's words are NOT on the cost row — that is what agent_messages is for.
    expect(JSON.stringify(meta)).not.toContain('one turn');
  });

  it('a model reply that is junk still spent, so it still posts a row', async () => {
    h.replies.push({ content: 'not json at all', inputTokens: 4_500, outputTokens: 12 });
    const r = await ask('something');

    expect(rowsFor('plan-agent:parse-tasks')).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: 'unresolved' });   // degraded to a clarify, as designed
  });
});

/**
 * THE GAP, NOW CLOSED.
 *
 * This block used to assert a shortfall: a query turn made THREE billable calls and produced two
 * rows, because nothing in @sprigly/knowledge accepted an auditor. It was written to fail the day
 * the embed write landed. It has, so it now asserts the opposite — three calls, three rows — and
 * the arithmetic that made the old gap easy to dismiss is stated rather than repeated, because
 * "fractions of a fraction of a penny" is exactly the reasoning that let it sit unmeasured.
 */
describe('the embed is spent AND measured', () => {
  it('a query turn embeds once and posts a row for it', async () => {
    h.replies.push({ ...QUERY }, { ...ANSWER });
    await ask('what is scheduled this week?');

    expect(h.embeds).toBe(1);                                                   // it happened
    expect(rows().some((r) => String(r.modelId).includes('titan'))).toBe(true); // and it is on the ledger
    expect(rows()).toHaveLength(3);                                             // 3 calls, 3 rows
  });

  it('the embed is priced — tiny, but never a fake zero', async () => {
    h.replies.push({ ...QUERY }, { ...ANSWER });
    await ask('what is scheduled this week?');

    const embed = Number(rowsFor('plan-agent:query-embed')[0]!.costPence);
    // 60 tokens x 1.58p per 1M = 0.0000948p, stored to micropence as 0.000095.
    expect(embed).toBe(0.000095);
    expect(embed).toBeGreaterThan(0);
  });

  it('costs three orders of magnitude less than the answer beside it — and the ledger shows it', async () => {
    h.replies.push({ ...QUERY }, { ...ANSWER });
    await ask('what is scheduled this week?');

    const embed  = Number(rowsFor('plan-agent:query-embed')[0]!.costPence);
    const answer = Number(rowsFor('plan-agent:answer-query')[0]!.costPence);
    expect(answer / embed).toBeGreaterThan(500);
    // Before migration 0091 both of these posted as 1p, indistinguishable. That is what a
    // ledger looks like when it counts calls instead of measuring spend.
  });

  it('an embedder that cannot report usage writes NO row rather than a guessed one', async () => {
    // The fallback path in retrieveChunks: no `embedWithUsage`, so no honest token count exists.
    // Silence is the correct outcome; an estimated cost row would be worse than none.
    h.usageCapable = false;
    h.replies.push({ ...QUERY }, { ...ANSWER });
    await ask('what is scheduled this week?');

    expect(h.embeds).toBe(1);                                    // the call still happened
    expect(rowsFor('plan-agent:query-embed')).toHaveLength(0);   // and is honestly unrecorded
    expect(rows()).toHaveLength(2);
  });
});
