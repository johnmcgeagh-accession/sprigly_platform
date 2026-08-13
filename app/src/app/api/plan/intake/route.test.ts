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
  distributeCalls: [] as Array<Record<string, unknown>>,
  distributeReturn: {} as Record<string, string>,
  activityCalls: [] as Array<Record<string, unknown>>,
  activityShouldFail: false,
  updateShouldFail: false,
  /** The month as it stands, as `loadDraftBeats` would return it. Empty = an unassembled month. */
  draftBeats: [] as Array<Record<string, unknown>>,
  applyCalls: [] as Array<Record<string, unknown>>,
  applyResult: null as Record<string, unknown> | null,
  applyShouldThrow: false,
  /** What the shortfall detector reports back, and the audit rows the route writes from it. */
  shortfallReturn: { named: [] as string[], missing: [] as string[] },
  shortfallCalls: [] as unknown[],
  auditInserts: [] as Array<Record<string, unknown>>,
}));

vi.mock('drizzle-orm', () => ({
  and: (...p: unknown[]) => ({ op: 'and', p }), eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }),
  gte: () => 'gte', lte: () => 'lte', or: () => 'or', isNull: () => 'isNull', inArray: () => 'inArray',
}));
vi.mock('@sprigly/db', () => ({
  db: {
    // .where().limit() → cycle lookup (h.cycleRow); .where() awaited → loadDurableContext ([] by default).
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([] as unknown[]), { limit: () => Promise.resolve(h.cycleRow) }) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => {
      if (h.updateShouldFail && 'intakeJson' in v) return { where: () => Promise.reject(new Error('update failed')) };
      h.updateSets.push(v); return { where: () => Promise.resolve(undefined) };
    } }),
    // The post-parse outcome row. Captured rather than discarded: "the loss is recorded" is the
    // whole point of the row, so a test that cannot see it cannot check the thing that matters.
    insert: () => ({ values: (v: Record<string, unknown>) => { h.auditInserts.push(v); return Promise.resolve(undefined); } }),
  },
  contentCycles: new Proxy({}, { get: (_t, p) => String(p) }),
  planInputs: new Proxy({}, { get: (_t, p) => String(p) }),
  auditLog: new Proxy({}, { get: (_t, p) => String(p) }),
  clientProductCatalogue: new Proxy({}, { get: (_t, p) => String(p) }),
  clearStructuredBriefIfPrePlanning: (...a: unknown[]) => { h.clearCalls.push(a); return Promise.resolve('cleared'); },
  PRE_PLANNING_STATUSES: new Set(['scheduled', 'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed']),
}));
vi.mock('@sprigly/engine', () => ({
  BASE_QUESTIONS: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
  extractStructuredBrief: (...a: unknown[]) => { h.extractCalls.push(a[0]); return h.extractShouldFail ? Promise.reject(new Error('extract failed')) : Promise.resolve({ products: [{ product: 'Wren', colourway: 'sage', status: 'new', launch_date: null, content_from: null }], schedule: [{ date: '2026-07-25', dateRange: null, type: 'launch', product: null, colourway: null, note: 'launch on the 25th' }], content_asks: [], focus: [], conflicts: [], plan_window: { from: null, month: null } }); },
  distributeBriefAnswers: (a: Record<string, unknown>) => { h.distributeCalls.push(a); return Promise.resolve(h.distributeReturn); },
  // Mocked at the module boundary like the reshape below — the detector has its own tests
  // (packages/engine brief-shortfall.test.ts, against the live brief that dropped Maggie). What
  // belongs here is the ROUTE's decision: what it does with the answer.
  briefProductShortfall: (...a: unknown[]) => { h.shortfallCalls.push(a); return h.shortfallReturn; },
}));
// The month's current shape, and the additive reshape it feeds. Mocked at the module boundary
// so this stays a unit test of the ROUTE's decisions — which beats the extractor is given, and
// whether a brief reaches the draft at all — rather than of the reshape itself (that has its
// own tests in draft-apply).
vi.mock('@/lib/plan', () => ({ loadDraftBeats: () => Promise.resolve(h.draftBeats) }));
vi.mock('@/lib/draft-apply', () => ({
  applyBriefToDraft: (a: Record<string, unknown>) => {
    h.applyCalls.push(a);
    if (h.applyShouldThrow) return Promise.reject(new Error('model down'));
    return Promise.resolve(h.applyResult ?? {
      ok: true,
      application: { id: 'rcpt-1', at: 'now', sourceText: 'x', scope: 'month_scoped', lines: ['moved'], changedIds: ['b1'] },
      beats: [{ id: 'b1', date: '2026-07-12', title: 'Launch' }],
    });
  },
}));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}) }));
vi.mock('@/lib/cycle-nav', () => ({ nextMonth: (m: string) => m }));
vi.mock('@/lib/activity', () => ({
  USER_ACTOR: { origin: 'user', actor: 'client' },
  recordActivity: (_db: unknown, e: Record<string, unknown>) => {
    if (h.activityShouldFail) return Promise.reject(new Error('ledger down'));
    h.activityCalls.push(e); return Promise.resolve(undefined);
  },
}));
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
  h.distributeCalls.length = 0; h.distributeReturn = {};
  h.activityCalls.length = 0; h.activityShouldFail = false; h.updateShouldFail = false;
  h.draftBeats.length = 0; h.applyCalls.length = 0; h.applyResult = null; h.applyShouldThrow = false;
  h.shortfallReturn = { named: [], missing: [] }; h.shortfallCalls.length = 0;
  h.auditInserts.length = 0;
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

  // ── The seeded composer comes back holding the saved brief ──────────────────────────
  // Both surfaces now arrive pre-filled (the workspace composer seeds from intake.freeNotes;
  // the guided stepper always has). An unconditional append stored the month twice.
  it('SEEDED RESUBMIT: freeNotes identical to what is held replaces rather than doubles', async () => {
    const saved = 'Big launch of Hannah in green on the 15th.';
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: { planContent: { answers: {}, freeNotes: saved }, businessContext: [], otherChannel: {}, source: 'manual', capturedAt: 'x' } }];
    await call({ cycleId: CYCLE, freeNotes: saved, source: 'web' });
    const set = h.updateSets[0]!.intakeJson as { planContent: { freeNotes: string } };
    expect(set.planContent.freeNotes).toBe(saved);                      // NOT `${saved}\n\n${saved}`
  });

  it('SEEDED RESUBMIT: the seed plus a new sentence is stored once, whole', async () => {
    const saved = 'Big launch of Hannah in green on the 15th.';
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: { planContent: { answers: {}, freeNotes: saved }, businessContext: [], otherChannel: {}, source: 'manual', capturedAt: 'x' } }];
    await call({ cycleId: CYCLE, freeNotes: `${saved}\n\nAlso London Fashion Week from the 18th.`, source: 'web' });
    const set = h.updateSets[0]!.intakeJson as { planContent: { freeNotes: string } };
    expect(set.planContent.freeNotes).toBe(`${saved}\n\nAlso London Fashion Week from the 18th.`);
    expect(set.planContent.freeNotes.match(/Hannah/g)).toHaveLength(1);  // the launch is told once
  });

  it('a genuine addition (composer cleared after a save) still appends', async () => {
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: { planContent: { answers: {}, freeNotes: 'note1' }, businessContext: [], otherChannel: {}, source: 'manual', capturedAt: 'x' } }];
    await call({ cycleId: CYCLE, freeNotes: 'a separate thought', source: 'web' });
    const set = h.updateSets[0]!.intakeJson as { planContent: { freeNotes: string } };
    expect(set.planContent.freeNotes).toBe('note1\n\na separate thought');
  });

  // ── plan_activity: the brief is the one client act that recorded nothing ────────────
  describe('the ledger row', () => {
    it('one brief_saved row per successful pre-cutoff save, attributed to the client, on the cycle', async () => {
      await call({ cycleId: CYCLE, freeNotes: 'launching on the 25th', source: 'web' });
      expect(h.activityCalls).toHaveLength(1);
      expect(h.activityCalls[0]).toMatchObject({
        clientId: CLIENT,
        cycleId:  CYCLE,
        action:   'brief_saved',
        actor:    { origin: 'user', actor: 'client' },
      });
      expect(h.activityCalls[0]!.postId).toBeUndefined();   // about the month, not a row in it
    });

    it('carries the shape of what was saved, and the channel it arrived on', async () => {
      await call({ cycleId: CYCLE, answers: { q1: 'a', q2: 'b' }, freeNotes: 'twelve chars', source: 'voice' });
      expect(h.activityCalls[0]!.payload).toEqual({ source: 'voice', answersSaved: 2, freeNotesChars: 12 });
    });

    it('NO row when the save itself failed', async () => {
      h.updateShouldFail = true;
      await expect(call({ cycleId: CYCLE, freeNotes: 'launching on the 25th', source: 'web' })).rejects.toThrow();
      expect(h.activityCalls).toHaveLength(0);
    });

    it('NO row when there was nothing to save (durable items only)', async () => {
      await call({ cycleId: CYCLE, durableItems: [{ type: 'idea', text: 'linen restock' }], source: 'web' });
      expect(h.durableCalls).toHaveLength(1);
      expect(h.activityCalls).toHaveLength(0);
    });

    it('NO row post-cutoff — that path routes to proposals and never touches intake_json', async () => {
      h.cycleRow = [{ status: 'planning', cycleMonth: '2026-06', intakeJson: null }];
      await call({ cycleId: CYCLE, freeNotes: 'launching on the 25th', source: 'web' });
      expect(h.turnCalls).toHaveLength(1);
      expect(h.activityCalls).toHaveLength(0);
    });

    // The brief IS saved by the time the ledger is written. A 500 here would tell the client it
    // was not, and what they do about that is retype the month — the duplication this change closes.
    it('a ledger failure never fails a save that already landed', async () => {
      h.activityShouldFail = true;
      const res = await call({ cycleId: CYCLE, freeNotes: 'launching on the 25th', source: 'web' });
      expect(res.status).toBe(200);
      expect((await res.json()).mode).toBe('brief_updated');
      expect(h.updateSets.some((u) => 'intakeJson' in u)).toBe(true);
    });
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

  it('records the shortfall when the extraction returns fewer products than the brief names', async () => {
    h.shortfallReturn = { named: ['Hannah', 'Connie', 'Maggie'], missing: ['Maggie'] };
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: null }];
    const res = await call({ cycleId: CYCLE, freeNotes: 'launch Maggie in yellow on the 12th', source: 'web' });
    const body = await res.json();

    // The brief is KEPT. A shortfall is a measurement of what came back, not a veto on it —
    // four of five products beats the null a rejection would leave.
    expect(body.beatsReady).toBe(true);
    expect(h.updateSets.some((u) => 'structuredBrief' in u)).toBe(true);

    expect(h.auditInserts).toHaveLength(1);
    const meta = h.auditInserts[0]!.metadata as { outcome: string; named: string[]; missing: string[] };
    expect(meta.outcome).toBe('shortfall');
    expect(meta.missing).toEqual(['Maggie']);
    expect(meta.named).toEqual(['Hannah', 'Connie', 'Maggie']);
  });

  it('writes no row when the extraction returned everything the brief named', async () => {
    h.shortfallReturn = { named: ['Hannah'], missing: [] };
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: null }];
    const res = await call({ cycleId: CYCLE, freeNotes: 'launch Hannah in green on the 12th', source: 'web' });
    expect((await res.json()).beatsReady).toBe(true);
    // Silence is the common case — this runs on every keystroke-driven save.
    expect(h.auditInserts).toHaveLength(0);
  });

  it('gives the extractor a logger, so its own count log can fire', async () => {
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: null }];
    await call({ cycleId: CYCLE, freeNotes: 'launch Hannah on the 12th', source: 'web' });
    const params = h.extractCalls[0] as { logger?: { info: unknown; warn: unknown } };
    expect(typeof params.logger?.info).toBe('function');
    expect(typeof params.logger?.warn).toBe('function');
  });

  it('FREEFORM (Prompt 2): distributes the brief into EMPTY answer slots + returns an extracted summary', async () => {
    h.distributeReturn = { 'Any key dates next month?': 'Launching Wren on the 25th', q1: 'kept' };
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: { planContent: { answers: { q1: 'kept' }, freeNotes: '' }, businessContext: [], otherChannel: {}, source: 'manual', capturedAt: 'x' } }];
    const res = await call({ cycleId: CYCLE, answers: {}, freeNotes: 'Launching Wren on the 25th, and a warehouse sale.', questions: ['Any key dates next month?'], source: 'web' });
    const body = await res.json();
    expect(body.mode).toBe('brief_updated');
    // distribution ran on the merged free text, keyed by the client-sent questions
    expect(h.distributeCalls).toHaveLength(1);
    expect(h.distributeCalls[0]!.questions).toEqual(['Any key dates next month?']);
    const set = h.updateSets[0]!.intakeJson as { planContent: { answers: Record<string, string> } };
    expect(set.planContent.answers['Any key dates next month?']).toBe('Launching Wren on the 25th');  // empty slot filled
    expect(set.planContent.answers.q1).toBe('kept');                                                   // existing answer never clobbered
    // the feedback summary reflects the extracted brief (a launch product + a dated beat)
    expect(body.extracted.launches).toContain('Wren in sage — new');
    expect(body.extracted.dates).toEqual([{ when: '25 Jul', label: 'launch' }]);
  });

  it('FREEFORM: nothing-extractable text still saves the note (distribution {} ; free text is never lost)', async () => {
    h.distributeReturn = {};
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: null }];
    const res = await call({ cycleId: CYCLE, answers: {}, freeNotes: 'just thinking out loud', source: 'web' });
    const body = await res.json();
    expect(body.mode).toBe('brief_updated');
    const set = h.updateSets.find((u) => 'intakeJson' in u)!.intakeJson as { planContent: { freeNotes: string } };
    expect(set.planContent.freeNotes).toBe('just thinking out loud');   // saved as freeNotes regardless
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

/**
 * The brief is read against the month, and then reshapes it.
 *
 * Two halves of one behaviour, and the ORDER between them is the thing worth pinning: the
 * extractor is given the month as it stood BEFORE this submission, so a sentence naming a date
 * resolves against what the client was looking at — not against the month their own words are
 * about to produce.
 */
describe('POST /api/plan/intake — a brief on a month that already has a draft', () => {
  const DRAFT = [
    { id: 'b1', date: '2026-07-08', title: 'Launch build-up' },
    { id: 'b2', date: '2026-07-20', title: 'Sunday Style' },
  ];

  it('gives the extractor the current beats as title + date, and nothing else', async () => {
    h.draftBeats.push(...DRAFT);
    await call({ cycleId: CYCLE, freeNotes: 'move the launch post to the 12th' });
    const params = h.extractCalls[0] as { currentPlan?: unknown[] };
    expect(params.currentPlan).toEqual([
      { date: '2026-07-08', title: 'Launch build-up' },
      { date: '2026-07-20', title: 'Sunday Style' },
    ]);
  });

  it('passes no plan state when the month holds no draft', async () => {
    await call({ cycleId: CYCLE, freeNotes: 'big launch on the 25th' });
    const params = h.extractCalls[0] as { currentPlan?: unknown[] };
    expect(params.currentPlan).toEqual([]);
  });

  it('routes the brief through the additive reshape and returns the refreshed month', async () => {
    h.draftBeats.push(...DRAFT);
    const res = await call({ cycleId: CYCLE, freeNotes: 'move the launch post to the 12th' });
    const body = await res.json();

    expect(h.applyCalls).toHaveLength(1);
    expect(h.applyCalls[0]).toMatchObject({ clientId: CLIENT, cycleId: CYCLE, text: 'move the launch post to the 12th' });
    expect(body.draftApplied).toBe(true);
    expect(body.beats).toEqual([{ id: 'b1', date: '2026-07-12', title: 'Launch' }]);
    expect(body.application.changedIds).toEqual(['b1']);
  });

  it('applies THE SUBMISSION, not the merged brief — a re-save cannot re-apply history', async () => {
    h.cycleRow = [{ status: 'requested', cycleMonth: '2026-06', intakeJson: { planContent: { answers: {}, freeNotes: 'a launch on the 3rd' } } }];
    h.draftBeats.push(...DRAFT);
    await call({ cycleId: CYCLE, freeNotes: 'also add a restock on the 20th' });
    // The stored sentence is merged into intake_json (below) but never re-applied to the month.
    expect(String(h.applyCalls[0]!.text)).toBe('also add a restock on the 20th');
    const merged = h.updateSets[0]!.intakeJson as { planContent: { freeNotes: string } };
    expect(merged.planContent.freeNotes).toContain('a launch on the 3rd');
    expect(merged.planContent.freeNotes).toContain('also add a restock on the 20th');
  });

  it('leaves an unassembled month exactly as it was — no reshape, original response', async () => {
    const res = await call({ cycleId: CYCLE, freeNotes: 'big launch on the 25th' });
    const body = await res.json();
    expect(h.applyCalls).toHaveLength(0);
    expect(body.draftApplied).toBe(false);
    expect(body.beats).toBeUndefined();
    expect(body.mode).toBe('brief_updated');
    expect(body.beatsReady).toBe(true);
  });

  it('writes intake_json whether or not the month was reshaped', async () => {
    h.draftBeats.push(...DRAFT);
    await call({ cycleId: CYCLE, freeNotes: 'move the launch post to the 12th' });
    expect((h.updateSets[0]!.intakeJson as { planContent: { freeNotes: string } }).planContent.freeNotes)
      .toBe('move the launch post to the 12th');

    h.updateSets.length = 0; h.applyCalls.length = 0; h.draftBeats.length = 0;
    await call({ cycleId: CYCLE, freeNotes: 'big launch on the 25th' });
    expect((h.updateSets[0]!.intakeJson as { planContent: { freeNotes: string } }).planContent.freeNotes)
      .toBe('big launch on the 25th');
  });

  /** The save has already landed by this point. A reshape that cannot finish must say so —
   *  a month that did not change is indistinguishable from one nobody asked to change. */
  it('surfaces a refused reshape rather than dropping it, and still keeps the brief', async () => {
    h.draftBeats.push(...DRAFT);
    h.applyResult = { ok: false, error: 'cutoff_passed', message: 'This month’s draft is closed for changes.' };
    const res = await call({ cycleId: CYCLE, freeNotes: 'move the launch post' });
    const body = await res.json();
    expect(body.draftApplied).toBe(false);
    expect(body.draftApplyError).toBe('This month’s draft is closed for changes.');
    expect(h.updateSets[0]!.intakeJson).toBeTruthy();
  });

  it('a thrown reshape is caught, reported, and never loses the save', async () => {
    h.draftBeats.push(...DRAFT);
    h.applyShouldThrow = true;
    const res = await call({ cycleId: CYCLE, freeNotes: 'move the launch post' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.draftApplied).toBe(false);
    expect(String(body.draftApplyError)).toContain('couldn’t update the month');
    expect(h.updateSets[0]!.intakeJson).toBeTruthy();
  });

  /**
   * The receipts live on `intake_json` as a key `IntakeJson` does not declare, and the merge
   * used to rebuild the object from the declared five — so every brief save deleted the history
   * of every voice reshape before it.
   */
  it('keeps the reshape receipts a save did not write', async () => {
    const priorReceipts = [{ id: 'rcpt-0', at: 'earlier', sourceText: 'move the launch', scope: 'month_scoped', lines: [], changedIds: [] }];
    h.cycleRow = [{
      status: 'requested', cycleMonth: '2026-06',
      intakeJson: { planContent: { answers: {}, freeNotes: '' }, draftApplications: priorReceipts },
    }];
    h.draftBeats.push(...DRAFT);
    await call({ cycleId: CYCLE, freeNotes: 'add a restock on the 20th' });
    const written = h.updateSets[0]!.intakeJson as Record<string, unknown>;
    expect(written.draftApplications).toEqual(priorReceipts);
  });

  it('never reshapes a post-cutoff month — that path still routes to proposals', async () => {
    h.cycleRow = [{ status: 'planning', intakeJson: null, cycleMonth: '2026-06' }];
    h.draftBeats.push(...DRAFT);
    const res = await call({ cycleId: CYCLE, freeNotes: 'move the launch post' });
    expect((await res.json()).mode).toBe('proposed');
    expect(h.applyCalls).toHaveLength(0);
    expect(h.turnCalls).toHaveLength(1);
  });
});
