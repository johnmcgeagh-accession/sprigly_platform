/**
 * intake route test — the pre/post-cutoff classifier. Pre-cutoff MERGES into
 * intake_json.planContent (answers overwrite, freeNotes append) and clears the brief;
 * post-cutoff leaves intake_json untouched and routes to proposals via runPlanAgentTurn;
 * durableItems always land in plan_inputs with source; ownership is enforced; voice accepted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { clientId: string; cycleId: string } | null,
  cycleRow: [] as unknown[],
  updateSets: [] as Array<Record<string, unknown>>,
  clearCalls: [] as unknown[],
  durableCalls: [] as Array<Record<string, unknown>>,
  turnCalls: [] as Array<Record<string, unknown>>,
  extractCalls: [] as unknown[],
  extractShouldFail: false,
}));

vi.mock('drizzle-orm', () => ({
  and: (...p: unknown[]) => ({ op: 'and', p }), eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }),
  gte: () => 'gte', lte: () => 'lte', or: () => 'or', isNull: () => 'isNull', inArray: () => 'inArray',
}));
vi.mock('@sprigly/db', () => ({
  db: {
    // .where().limit() → cycle lookup (h.cycleRow); .where() awaited → loadDurableContext ([] by default).
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([] as unknown[]), { limit: () => Promise.resolve(h.cycleRow) }) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => { h.updateSets.push(v); return { where: () => Promise.resolve(undefined) }; } }),
  },
  contentCycles: new Proxy({}, { get: (_t, p) => String(p) }),
  planInputs: new Proxy({}, { get: (_t, p) => String(p) }),
  clearStructuredBriefIfPrePlanning: (...a: unknown[]) => { h.clearCalls.push(a); return Promise.resolve('cleared'); },
  PRE_PLANNING_STATUSES: new Set(['scheduled', 'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed']),
}));
vi.mock('@sprigly/engine', () => ({ extractStructuredBrief: (...a: unknown[]) => { h.extractCalls.push(a[0]); return h.extractShouldFail ? Promise.reject(new Error('extract failed')) : Promise.resolve({ products: [], schedule: [{ date: '2026-07-25', type: 'launch', product: null, colourway: null, note: 'launch on the 25th' }], content_asks: [], focus: [], conflicts: [], plan_window: { from: null, month: null } }); } }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}) }));
vi.mock('@/lib/cycle-nav', () => ({ nextMonth: (m: string) => m }));
vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/rate-limit', () => ({ allowRequest: () => true }));
vi.mock('@/lib/agent/notes', () => ({ saveDurableInput: (a: Record<string, unknown>) => { h.durableCalls.push(a); return Promise.resolve('pi-1'); } }));
vi.mock('@/lib/agent/turn', () => ({ runPlanAgentTurn: (a: Record<string, unknown>) => { h.turnCalls.push(a); return Promise.resolve({ conversationId: 'conv', message: '', proposals: [{ id: 'pv-1' }], changeSetId: 'cs' }); } }));

import { POST } from './route';

const CLIENT = 'client-1';
const CYCLE = 'cycle-9';
const call = (body: unknown) => POST(new Request('http://x/api/plan/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  h.session = { clientId: CLIENT, cycleId: CYCLE };
  h.cycleRow = [{ status: 'requested', intakeJson: null, cycleMonth: '2026-06' }];
  h.updateSets.length = 0; h.clearCalls.length = 0; h.durableCalls.length = 0; h.turnCalls.length = 0;
  h.extractCalls.length = 0; h.extractShouldFail = false;
});

describe('POST /api/plan/intake — classifier', () => {
  it('401 without a session', async () => {
    h.session = null;
    expect((await call({ cycleId: CYCLE })).status).toBe(401);
  });

  it('403 when the cycle does not belong to the client', async () => {
    h.cycleRow = [];
    const res = await call({ cycleId: 'someone-elses', answers: { q1: 'x' } });
    expect(res.status).toBe(403);
    expect(h.updateSets).toHaveLength(0);
    expect(h.turnCalls).toHaveLength(0);
  });

  it('PRE-cutoff: merges answers (overwrite) + appends freeNotes, clears the brief, and extracts inline (beats ready)', async () => {
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: { planContent: { answers: { q1: 'old' }, freeNotes: 'note1' }, businessContext: [], otherChannel: {}, source: 'manual', capturedAt: 'x' } }];
    const res = await call({ cycleId: CYCLE, answers: { q1: 'new', q2: 'added' }, freeNotes: 'note2', source: 'web' });
    const body = await res.json();
    expect(body.mode).toBe('brief_updated');
    expect(body.briefCleared).toBe(true);
    expect(body.beatsReady).toBe(true);                                    // FIX 2: extracted inline
    const set = h.updateSets[0]!.intakeJson as { planContent: { answers: Record<string, string>; freeNotes: string } };
    expect(set.planContent.answers).toEqual({ q1: 'new', q2: 'added' });   // q1 overwritten, q2 added
    expect(set.planContent.freeNotes).toBe('note1\n\nnote2');              // appended with a blank-line separator
    expect(h.clearCalls).toHaveLength(1);
    expect(h.extractCalls).toHaveLength(1);                                // extraction ran
    // the second update persisted the extracted structured_brief
    expect(h.updateSets.some((u) => 'structuredBrief' in u)).toBe(true);
  });

  it('FIX 2: extraction FAILURE is non-fatal — intake still saved, brief not persisted, beatsReady false', async () => {
    h.extractShouldFail = true;
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: null }];
    const res = await call({ cycleId: CYCLE, answers: { q1: 'launch on the 25th' }, source: 'web' });
    const body = await res.json();
    expect(body.mode).toBe('brief_updated');
    expect(body.briefCleared).toBe(true);
    expect(body.beatsReady).toBe(false);
    expect(h.updateSets.some((u) => 'intakeJson' in u)).toBe(true);        // intake WAS saved
    expect(h.updateSets.some((u) => 'structuredBrief' in u)).toBe(false);  // brief NOT persisted
  });

  it('PRE-cutoff with only durable items: no intake write, no brief clear, durable persists', async () => {
    const res = await call({ cycleId: CYCLE, durableItems: [{ type: 'idea', text: 'remember the linen restock' }], source: 'web' });
    const body = await res.json();
    expect(body.mode).toBe('brief_updated');
    expect(body.briefCleared).toBe(false);
    expect(h.updateSets).toHaveLength(0);
    expect(h.clearCalls).toHaveLength(0);
    expect(h.durableCalls[0]).toMatchObject({ clientId: CLIENT, type: 'idea', content: 'remember the linen restock', source: 'web' });
  });

  it('POST-cutoff: intake_json untouched; routes to proposals via runPlanAgentTurn', async () => {
    h.cycleRow = [{ status: 'planning', intakeJson: null }];
    const res = await call({ cycleId: CYCLE, answers: { 'Any key dates?': 'launch on the 5th' }, freeNotes: 'make Fridays warmer', source: 'web' });
    const body = await res.json();
    expect(body.mode).toBe('proposed');
    expect(h.updateSets).toHaveLength(0);      // intake_json NOT touched post-cutoff
    expect(h.clearCalls).toHaveLength(0);
    expect(h.turnCalls).toHaveLength(1);
    const turn = h.turnCalls[0]!;
    expect(turn.cycleId).toBe(CYCLE);
    expect(String(turn.instruction)).toContain('Any key dates? — launch on the 5th');
    expect(String(turn.instruction)).toContain('make Fridays warmer');
  });

  it('durableItems land regardless of cutoff, carrying source', async () => {
    h.cycleRow = [{ status: 'planning', intakeJson: null }];
    await call({ cycleId: CYCLE, durableItems: [{ type: 'next_cycle', text: 'plan a Connie relaunch' }], source: 'voice' });
    expect(h.durableCalls[0]).toMatchObject({ type: 'next_cycle', content: 'plan a Connie relaunch', source: 'voice' });
  });

  it('voice source is accepted and stamped on the merged intake', async () => {
    const res = await call({ cycleId: CYCLE, answers: { q1: 'x' }, source: 'voice', sessionId: 'sess-1' });
    expect(res.status).toBe(200);
    const set = h.updateSets[0]!.intakeJson as { source: string };
    expect(set.source).toBe('voice');
  });
});
