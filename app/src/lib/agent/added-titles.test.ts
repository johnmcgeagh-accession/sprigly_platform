/**
 * added-titles.test.ts — X3: a post the client named lands with that name on it.
 *
 * From the operator's session: a launch arc added by conversation. The interpretation named
 * every row — "Oak tree tease", "Oak tree launch" — and the calendar drew them all as
 * **Untitled**, indistinguishable until a caption had been generated and `cardText` could
 * derive a heading from its first sentence.
 *
 * There is no title COLUMN on a post; `source_meta.title` is the slot title every surface reads
 * (`card-text.ts`). The agent's add path never wrote one. So the fix is not a new field: it is
 * carrying the subject the parser already extracted — the same string the interpretation line
 * showed the client — through the proposal payload to the row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from './types';

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
  rows: [{ id: 'cyc-aug', month: '2026-07', status: 'workbook_built' }],
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@sprigly/audit', () => ({ createAuditLogger: () => ({ logModelCall: async () => undefined }) }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));
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
  ensureConversation: async () => 'conv-1', appendMessage: async () => 'msg-1',
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
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-07-31', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { titleFromSubject } from './selectors';
import { cardText } from '@/components/plan/surface/card-text';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice' });
const payloads = () => h.createCalls.map((c) => c.payload as Record<string, unknown>);

beforeEach(() => { h.tasks = []; h.createCalls.length = 0; });

describe('the launch arc, added by conversation', () => {
  const ARC = [
    { action: 'add_post', toDate: '2026-08-14', format: 'reel', instruction: 'Oak tree tease.',  reason: 'tease the oak tree' },
    { action: 'add_post', toDate: '2026-08-16', format: 'reel', instruction: 'Oak tree launch.', reason: 'launch it' },
    { action: 'add_post', toDate: '2026-08-18', format: 'reel', instruction: 'Oak tree in use.', reason: 'show it in use' },
  ] as ParsedTask[];

  it('EVERY row is titled from its own interpretation line', async () => {
    h.tasks = ARC;
    const r = await ask('tease the oak tree on the 14th, launch it on the 16th, show it in use on the 18th');
    expect(payloads().map((p) => p.title)).toEqual(['Oak tree tease', 'Oak tree launch', 'Oak tree in use']);
    // The title on the payload IS the title on the line the client consented to.
    expect(r.items.map((i) => (i.kind === 'change' ? i.title : null)))
      .toEqual(['Oak tree tease.', 'Oak tree launch.', 'Oak tree in use.']);
  });

  it('and the card that results reads the name, not "Untitled"', async () => {
    h.tasks = ARC;
    await ask('tease the oak tree, launch it, show it in use');
    // The row as `addGeneratingPost` writes it: a title, no caption yet.
    const asRow = { title: payloads()[1]!.title as string, caption: '' };
    expect(cardText(asRow)).toMatchObject({ heading: 'Oak tree launch', source: 'slot' });
    expect(cardText({ title: null, caption: '' }).heading).toBe('Untitled');   // the before, pinned
  });

  it('an add with NO subject still has no title — absent is honest, invented is not', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-08-14' }] as ParsedTask[];
    await ask('add a post on the 14th');
    expect(payloads()[0]!.title).toBeNull();
  });
});

describe('titleFromSubject — a title is not a sentence', () => {
  it('drops the trailing stop the parser’s instruction carries', () => {
    expect(titleFromSubject('Oak tree launch.')).toBe('Oak tree launch');
    expect(titleFromSubject('Introduce the Maebelle.')).toBe('Introduce the Maebelle');
  });

  it('keeps a question mark or an exclamation — those are the subject, not punctuation on it', () => {
    expect(titleFromSubject('Why linen?')).toBe('Why linen?');
  });

  it('collapses whitespace and caps at the same 44 characters postTitle uses', () => {
    expect(titleFromSubject('  Oak   tree \n launch ')).toBe('Oak tree launch');
    const long = titleFromSubject('A very long subject line that runs well past the forty-four character mark')!;
    expect(long).toHaveLength(44);
    expect(long.endsWith('…')).toBe(true);
  });

  it('empty, blank and null are all absent — never an empty-string title', () => {
    expect(titleFromSubject('')).toBeNull();
    expect(titleFromSubject('   ')).toBeNull();
    expect(titleFromSubject(null)).toBeNull();
    expect(titleFromSubject(undefined)).toBeNull();
    expect(titleFromSubject('.')).toBeNull();
  });
});
