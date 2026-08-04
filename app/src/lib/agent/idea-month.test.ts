/**
 * idea-month.test.ts — the month an idea names survives capture (F5).
 *
 * "I have an idea for October" parsed correctly — `targetMonth: "2026-10"` — and was then stored
 * with `cycle_id = null` and nothing else, because `targetMonth` was a CYCLE LOOKUP KEY and the
 * client has no October cycle. October survived only inside the free text.
 *
 * The month is now written to the relevance WINDOW, which is not a second meaning for those
 * columns but their first: both readers apply the same overlap predicate, one against a week
 * (`weekly-session.ts`) and one against a plan month (`intake-signals.ts:loadDurableInputs`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask } from './types';

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  saved: [] as Array<Record<string, unknown>>,
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', () => ({ parseTasks: async () => h.tasks }));
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  // AUGUST is the month on screen. There is no October cycle — the whole point.
  const ROWS = [{ id: 'cyc-aug', month: '2026-07', status: 'scheduled' }];
  return {
    ...real,
    listClientCycles: async () => ROWS,
    getCycleMonth: async () => '2026-08',
    resolveCycleForMonth: async (_c: string, m: string) => (m === '2026-08' ? 'cyc-aug' : null),
  };
});
vi.mock('@/lib/agent/conversation', () => ({
  ensureConversation: async () => 'conv-1', appendMessage: async () => 'msg-1',
  listTurns: async () => [], threadForParser: () => '', latestPendingIntent: () => null, intentForParser: () => '',
}));
vi.mock('@/lib/agent/proposals', () => ({ createProposal: async () => ({ id: 'pv-1' }), loadPendingPayloads: async () => [], rejectProposal: async () => null }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: async () => 'answer' }));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async (a: Record<string, unknown>) => { h.saved.push(a); return 'note-1'; } }));
vi.mock('@sprigly/audit', () => ({ createAuditLogger: () => ({ logModelCall: async () => undefined }) }));
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-08-04', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { ideaPlacement } from '@/components/plan/surface/Interpretation';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice' });

const note = (over: Partial<ParsedTask> = {}) =>
  [{ action: 'add_note', content: 'TV Halloween theme, people focused on Hannah.', ...over }] as ParsedTask[];

beforeEach(() => { h.tasks = []; h.saved.length = 0; });

describe('a month with NO cycle is still kept', () => {
  it('writes the month as the relevance window instead of dropping it', async () => {
    h.tasks = note({ targetMonth: '2026-10' });
    await ask('I have an idea for October');

    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({ cycleId: null, relevantFrom: '2026-10-01', relevantTo: '2026-10-31' });
  });

  it('the window is what the two readers already query, so October’s run can find it', () => {
    // Both overlap predicates, verbatim: intake-signals (plan month) and weekly-session (week).
    const [from, to] = ['2026-10-01', '2026-10-31'];
    const overlapsMonth = (m: string) => from < `${m.slice(0, 4)}-${String(Number(m.slice(5)) + 1).padStart(2, '0')}-01` && to >= `${m}-01`;
    expect(overlapsMonth('2026-10')).toBe(true);
    // And it is no longer live in every week of every month, which a null window made it.
    expect(from <= '2026-08-09' && to >= '2026-08-03').toBe(false);
  });

  it('the reply states the window it actually stored', async () => {
    h.tasks = note({ targetMonth: '2026-10' });
    const r = await ask('I have an idea for October');
    expect(r.message).toContain('(relevant 2026-10-01 to 2026-10-31)');
  });

  it('the interpretation item carries the month, so the surface can name it', async () => {
    h.tasks = note({ targetMonth: '2026-10' });
    const r = await ask('I have an idea for October');
    expect(r.items).toEqual([{ kind: 'idea', text: 'TV Halloween theme, people focused on Hannah.', month: '2026-10' }]);
  });
});

describe('the month bound is computed, never written as a literal', () => {
  // `${month}-31` is an INVALID DATE for Sep/Apr/Jun/Nov and February, and Postgres rejects it
  // against a date column rather than clamping — the trap intake-signals.ts already documents.
  it.each([
    ['2026-09', '2026-09-30'],
    ['2026-02', '2026-02-28'],
    ['2028-02', '2028-02-29'],
    ['2026-12', '2026-12-31'],
  ])('%s ends on %s', async (month, last) => {
    h.tasks = note({ targetMonth: month });
    await ask('an idea');
    expect(h.saved[0]).toMatchObject({ relevantFrom: `${month}-01`, relevantTo: last });
  });
});

describe('what the change does NOT do', () => {
  it('an idea with no month is stored undated, exactly as before', async () => {
    h.tasks = note();
    const r = await ask('remember the candle relaunch is coming');
    expect(h.saved[0]).toMatchObject({ cycleId: 'cyc-aug', relevantFrom: null, relevantTo: null });
    expect(r.items).toEqual([{ kind: 'idea', text: 'TV Halloween theme, people focused on Hannah.', month: null }]);
  });

  it('a window the CLIENT named wins over the month bounds — we never overwrite what they said', async () => {
    h.tasks = note({ targetMonth: '2026-10', relevantFrom: '2026-10-28', relevantTo: '2026-10-31' });
    await ask('an idea for Halloween week in October');
    expect(h.saved[0]).toMatchObject({ relevantFrom: '2026-10-28', relevantTo: '2026-10-31' });
  });

  it('a month that DOES resolve still files under its cycle, and now also carries the window', async () => {
    h.tasks = note({ targetMonth: '2026-08' });
    await ask('a note for August');
    expect(h.saved[0]).toMatchObject({ cycleId: 'cyc-aug', relevantFrom: '2026-08-01', relevantTo: '2026-08-31' });
  });
});

describe('the surface line is derived from the item', () => {
  it('names the month when there is one', () => {
    expect(ideaPlacement('2026-10')).toBe('kept for October 2026.');
  });

  it('falls back only when there really is no month', () => {
    expect(ideaPlacement(null)).toBe('no date to place it on.');
    expect(ideaPlacement(undefined)).toBe('no date to place it on.');
    expect(ideaPlacement('nonsense')).toBe('no date to place it on.');
  });
});
