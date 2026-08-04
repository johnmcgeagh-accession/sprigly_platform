/**
 * draft-month-writes.test.ts — the agent may not write into a month that is still a draft.
 *
 * ── The failure this closes ──────────────────────────────────────────────────────────
 *
 * IVY-t, September 2026: thirty rows, all `status='draft'`, rendered on the draft surface with
 * its approval flow and its receipts. From the committed AUGUST view the agent could still
 * propose `add_post` onto a September date, because `cycleForMonth` finds September's cycle and
 * nothing asked what state it was in. Approving it inserted `status='generating'` into that
 * cycle — a status `loadDraftBeats` cannot see and `loadPlanPosts` can, so `committedPostCount`
 * went 0 → 1 and `resolveSurfaceKind` flipped the month out of its draft surface. Thirty planned
 * posts, the approval flow and the receipts stopped rendering. One approved proposal away.
 *
 * The move is the quieter twin: a post keeps its own `cycle_id` through a move, so an August
 * post sent to a September date flips nothing and disappears instead — out of August's
 * date-keyed grid, and never into September's, because `DraftSurface` renders planned posts only.
 *
 * ── Why the refusal is HERE and not only at the write ────────────────────────────────
 *
 * `mutations.ts` refuses both (edit-scope.ts → `landsInDraftMonth`), but it can only return
 * null, and a null there is indistinguishable from the past-date refusal beside it. Refusing at
 * proposal time is what the client actually reads — before they tap Apply on a change that was
 * never going to happen. `proposals.test.ts` pins the same refusal at approve time, for the
 * proposal that was made before the month entered draft.
 *
 * Pinned to 2026-08-04 — the day of the live session, August on screen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const post = (id: string, cycleId: string, date: string, caption: string, format = 'single') =>
  ({ id, cycleId, clientId: 'c1', channel: 'instagram', date, format, pillar: 'Launch', caption, status: 'planned', reviewState: null });

/** August is committed and live. September is the draft month — its rows are drafts, so
 *  `loadPlanPosts` (draft-fenced) returns nothing for it, exactly as it does in production. */
const AUG = [
  post('p-aug-4',  'cyc-aug', '2026-08-04', 'Portugal factory closes'),
  post('p-aug-14', 'cyc-aug', '2026-08-14', 'Weekend style guide', 'carousel'),
];

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  postsByCycle: {} as Record<string, unknown[]>,
  rows: [] as Array<{ id: string; month: string; status: string }>,
  createCalls: [] as Array<Record<string, unknown>>,
  /** What `loadDraftCycles` reports. Plan months, keyed as the real one keys them. */
  draftPlanMonths: [] as Array<[string, string]>,
  /** Set to make the draft read THROW, so the degrade path is a tested path. */
  draftReadFails: false,
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, conversations: {}, agentMessages: {} }));
vi.mock('@sprigly/audit', () => ({ createAuditLogger: () => ({ logModelCall: async () => undefined }) }));
vi.mock('@sprigly/knowledge', () => ({ retrieveChunks: async () => [] }));
vi.mock('@/lib/plan', () => ({
  loadPlanPosts: async (_c: string, cycleId: string) => h.postsByCycle[cycleId] ?? [],
  loadDraftBeats: async () => [],
}));
vi.mock('@/lib/agent/model', () => ({
  getModelClient: () => ({ complete: async () => ({ content: 'ok', modelId: 'fake', inputTokens: 1, outputTokens: 1 }) }),
  getEmbeddingClient: () => ({}),
  AGENT_MODEL: 'fake',
}));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', () => ({ parseTasks: async () => h.tasks }));
// The REAL edit-scope rules, with only the database read faked — so `isEditableDate` and
// `canAddPost` keep deciding, and only "which months are drafts" is the harness's to say.
vi.mock('@/lib/edit-scope', async (orig) => {
  const real = await orig<typeof import('../edit-scope')>();
  return {
    ...real,
    loadDraftCycles: async () => {
      if (h.draftReadFails) throw new Error('db down');
      return { byId: new Set(h.draftPlanMonths.map(([, id]) => id)), byPlanMonth: new Map(h.draftPlanMonths) };
    },
  };
});
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  return { ...real, listClientCycles: async () => h.rows };
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
  loadPendingPayloads: async () => [], rejectProposal: async () => null,
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));
vi.mock('@/lib/usage', () => ({ getUsageForCycle: async () => ({ used: 0, limit: 30, unlimited: true }), remainingAiChanges: () => 30 }));
// THE DAY OF THE SESSION: 4 August 2026, August on screen.
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-08-04', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice' });

beforeEach(() => {
  h.tasks = [];
  h.createCalls.length = 0;
  h.draftReadFails = false;
  h.rows = [
    { id: 'cyc-aug', month: '2026-07', status: 'scheduled' },   // plans AUGUST   — committed
    { id: 'cyc-sep', month: '2026-08', status: 'scheduled' },   // plans SEPTEMBER — the draft
  ];
  // September's rows are all drafts, so the draft-fenced reader returns none.
  h.postsByCycle = { 'cyc-aug': [...AUG], 'cyc-sep': [] };
  h.draftPlanMonths = [['2026-09', 'cyc-sep']];
});

describe('add_post into a draft month', () => {
  it('is refused, and NOTHING is proposed', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-09-15', format: 'reel', instruction: 'Back to school.', reason: 'add a reel about back to school' }];
    const r = await ask('add a reel about back to school on 15 September');
    expect(h.createCalls).toHaveLength(0);
    expect(r.proposals).toHaveLength(0);
  });

  it('says WHY, naming the month, and does not blame the date', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-09-15', format: 'reel', instruction: 'Back to school.', reason: 'x' }];
    const r = await ask('add a reel on 15 September');
    expect(r.message).toContain('September 2026');
    expect(r.message).toContain('draft');
    // The two refusals it must not be mistaken for: the past-date one and the no-such-month one.
    expect(r.message).not.toContain('already passed');
    expect(r.message).not.toContain('no September 2026 plan yet');
  });

  it('renders as an unresolved item, so a compound turn shows both halves', async () => {
    h.tasks = [
      { action: 'add_post', toDate: '2026-09-15', format: 'reel', instruction: 'Back to school.', reason: 'a' },
      { action: 'add_post', toDate: '2026-08-20', format: 'reel', instruction: 'Linen.', reason: 'b' },
    ];
    const r = await ask('add one in September and one on the 20th');
    expect(r.items.filter((i) => i.kind === 'unresolved')).toHaveLength(1);
    expect(r.items.filter((i) => i.kind === 'change')).toHaveLength(1);   // August still lands
    expect(h.createCalls).toHaveLength(1);
  });

  it('an add into the LIVE month is untouched', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-08-20', format: 'reel', instruction: 'Linen.', reason: 'x' }];
    const r = await ask('add a linen reel on the 20th');
    expect(h.createCalls).toHaveLength(1);
    expect((h.createCalls[0]!.payload as Record<string, unknown>)['cycleId']).toBe('cyc-aug');
    expect(r.proposals).toHaveLength(1);
  });
});

describe('move_post into a draft month', () => {
  it('is refused, naming the month, with nothing proposed', async () => {
    h.tasks = [{ action: 'move_post', postId: 'p-aug-14', fromDate: '2026-08-14', toDate: '2026-09-10', reason: 'move it to September' }];
    const r = await ask('move the 14th to 10 September');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toContain('September 2026');
    expect(r.message).toContain('draft');
  });

  it('a move WITHIN the live month is untouched', async () => {
    h.tasks = [{ action: 'move_post', postId: 'p-aug-14', fromDate: '2026-08-14', toDate: '2026-08-20', reason: 'x' }];
    await ask('move the 14th to the 20th');
    expect(h.createCalls).toHaveLength(1);
    expect((h.createCalls[0]!.payload as Record<string, unknown>)['toDate']).toBe('2026-08-20');
  });
});

describe('the guard degrades the safe way', () => {
  /**
   * A failed draft read must not become the thing that stops a client editing a LIVE month.
   * It leaves this guard inert and `mutations.ts` as the backstop — which still refuses the
   * write, just without a sentence. The alternative (refuse everything on a failed read) would
   * turn one unreadable query into a total outage of the agent's write path.
   */
  it('an unreadable draft list lets ordinary work through rather than refusing it', async () => {
    h.draftReadFails = true;
    h.tasks = [{ action: 'add_post', toDate: '2026-08-20', format: 'reel', instruction: 'Linen.', reason: 'x' }];
    await ask('add a linen reel on the 20th');
    expect(h.createCalls).toHaveLength(1);
  });

  it('a month with NO cycle still gets its own refusal, not the draft one', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-12-01', format: 'reel', instruction: 'Christmas.', reason: 'x' }];
    const r = await ask('add a Christmas reel on 1 December');
    expect(h.createCalls).toHaveLength(0);
    expect(r.message).toContain('There’s no December 2026 plan yet');
    expect(r.message).not.toContain('draft');
  });
});
