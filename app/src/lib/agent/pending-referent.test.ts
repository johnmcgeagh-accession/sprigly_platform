/**
 * pending-referent.test.ts — C3: while a change is UNAPPLIED, it is what the next thing
 * resolves against.
 *
 * ── The video's case ─────────────────────────────────────────────────────────────────
 *
 * The client asks for a post, sees "Add a single image · Fri 21 Aug · Atlas Cedar restock"
 * sitting there unapplied, and says "instead of a single image make it a reel". That landed as
 * a `change_format` against a post that DOES NOT EXIST — the add was still a proposal — so the
 * agent either refused it or, worse, left two adds on screen for the client to apply both.
 *
 * The rule: an unapplied interpretation is the most recent thing said AND the thing on screen,
 * so a correction with no target of its own AMENDS it. The old proposal is rejected, a new one
 * is created carrying the amendment, and the sheet marks the old turn superseded — two versions
 * of one change must never both be applicable.
 *
 * The parser is faked here, as everywhere in this harness; what these tests pin is the
 * PLUMBING it needs to be right — the pending block reaching the prompt, the supersede
 * happening, and the amended interpretation coming back whole.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlanPost } from '../types';
import type { ParsedTask } from './types';
import type { ParserContext } from './task-parser';

const P = (id: string, date: string, caption: string): PlanPost => ({
  id, cycleId: 'cyc-aug', clientId: 'c1', channel: 'instagram', date,
  format: 'single', pillar: 'Style', caption, status: 'planned', reviewState: null, steps: [],
} as never);

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  contexts: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
  rejected: [] as string[],
  /** The pending rows `loadPendingPayloads` will answer with. */
  pending: [] as Array<{ id: string; intent: string; summary: string; payload: unknown }>,
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, conversations: {}, agentMessages: {}, agentProposals: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [P('p-aug-14', '2026-08-14', 'Weekend Style Guide')], loadDraftBeats: async () => [] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- (no products)' }));
vi.mock('@/lib/agent/task-parser', async (orig) => ({
  ...(await orig<typeof import('./task-parser')>()),
  parseTasks: async (_t: string, ctx: unknown) => { h.contexts.push(ctx); return h.tasks; },
}));
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  const ROWS = [{ id: 'cyc-aug', month: '2026-07', status: 'workbook_built' }];
  return {
    ...real,
    // X1a: the context seam reads the client's cycles through this one function.
    listClientCycles: async () => ROWS,
    getClientCycleMonths: async (_c: string, viewed: string) => real.describeCycles(ROWS, viewed),
    getCycleMonth: async () => real.planMonthOf('2026-07'),
  };
});
vi.mock('@/lib/agent/conversation', () => ({
  ensureConversation: async () => 'conv-1',
  listTurns: async () => [],
  threadForParser: () => '',
  appendMessage: async () => 'm1',
}));
vi.mock('@/lib/agent/proposals', () => ({
  createProposal: async (args: Record<string, unknown>) => {
    h.createCalls.push(args);
    return { id: `pv-${h.createCalls.length}`, intent: args.action, summary: args.summary, status: 'pending', changeSetId: args.changeSetId };
  },
  loadPendingPayloads: async (_c: string, ids: readonly string[]) => h.pending.filter((p) => ids.includes(p.id)),
  rejectProposal: async (_c: string, id: string) => { h.rejected.push(id); return null; },
}));
vi.mock('@/lib/agent/notes', () => ({ saveNote: async () => undefined }));
vi.mock('@/lib/agent/query', () => ({ answerQuery: async () => 'answer' }));
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-08-01', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { TASK_PARSER_SYSTEM_PROMPT } from './task-parser';

const ask = (instruction: string, pendingProposalIds: string[] = []) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-aug', instruction, source: 'voice', conversationId: 'conv-1', pendingProposalIds });
const lastCtx = () => h.contexts[h.contexts.length - 1] as ParserContext;

/** The video's pending change: an add the client has not applied. */
const PENDING_ADD = {
  id: 'pv-old', intent: 'add_post', summary: 'Add a single image on Fri 21 Aug: “Atlas Cedar restock”',
  payload: { kind: 'add', cycleId: 'cyc-aug', date: '2026-08-21', channel: 'instagram', instruction: 'Atlas Cedar restock', format: 'single' },
};

beforeEach(() => {
  h.tasks = []; h.contexts.length = 0; h.createCalls.length = 0; h.rejected.length = 0; h.pending = [];
});

describe('THE VIDEO: a pending add, corrected before it is applied', () => {
  beforeEach(() => { h.pending = [PENDING_ADD]; });

  it('the pending change reaches the prompt as the referent', async () => {
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('anything', ['pv-old']);
    const pending = lastCtx().pending ?? '';
    expect(pending).toContain('pv-old');
    expect(pending).toContain('add_post');
    expect(pending).toContain('Atlas Cedar restock');
  });

  it('"instead of a single image make it a reel" AMENDS it — same title, same date, format reel', async () => {
    h.tasks = [{
      action: 'add_post', toDate: '2026-08-21', format: 'reel',
      instruction: 'Atlas Cedar restock', amends: true, reason: 'make it a reel',
    }] as ParsedTask[];
    const r = await ask('instead of a single image make it a reel', ['pv-old']);

    // The old one is REJECTED, not left beside the new one.
    expect(h.rejected).toEqual(['pv-old']);
    expect(r.supersededProposalIds).toEqual(['pv-old']);

    // The new one is the SAME add with the corrected format.
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0]!.payload).toMatchObject({
      kind: 'add', date: '2026-08-21', instruction: 'Atlas Cedar restock', format: 'reel',
    });
    // …and the interpretation the client reads says exactly that.
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      kind: 'change', action: 'add', title: 'Atlas Cedar restock', toDate: '2026-08-21', format: 'reel',
    });
  });

  it('a pending change already applied or discarded is NOT the referent — the sheet’s list is only what it last knew', async () => {
    h.pending = [];                                   // the server says nothing is pending now
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    const r = await ask('make it a reel', ['pv-old']);
    expect(lastCtx().pending).toBeUndefined();
    expect(h.rejected).toEqual([]);
    expect(r.supersededProposalIds).toBeUndefined();
  });

  it('nothing pending → no block at all, and an amend flag alone supersedes nothing', async () => {
    h.pending = [];
    h.tasks = [{ action: 'add_post', toDate: '2026-08-21', format: 'reel', amends: true }] as ParsedTask[];
    const r = await ask('make it a reel');
    expect(lastCtx().pending).toBeUndefined();
    expect(h.rejected).toEqual([]);
    expect(r.proposals).toHaveLength(1);              // it still lands, as an ordinary add
  });
});

describe('a pending move plus an UNRELATED new ask — both survive, as separate turns', () => {
  const PENDING_MOVE = {
    id: 'pv-move', intent: 'move_post', summary: 'Move “Weekend Style Guide” Fri 14 Aug → Sat 15 Aug',
    payload: { kind: 'move', cycleId: 'cyc-aug', postId: 'p-aug-14', toDate: '2026-08-15' },
  };

  it('the new ask does not amend, and the pending move is untouched', async () => {
    h.pending = [PENDING_MOVE];
    h.tasks = [{
      action: 'add_post', format: 'reel', instruction: 'The linen.', toDate: '2026-08-28',
      reason: 'also add a reel about the linen',
    }] as ParsedTask[];
    const r = await ask('also add a reel about the linen', ['pv-move']);

    // NOTHING superseded: the pending move is still the client's to apply.
    expect(h.rejected).toEqual([]);
    expect(r.supersededProposalIds).toBeUndefined();
    // And the new ask stands on its own.
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0]!.action).toBe('add_post');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ action: 'add', title: 'The linen.' });
  });

  it('but a correction of the move DOES amend it — same post, new destination', async () => {
    h.pending = [PENDING_MOVE];
    h.tasks = [{
      action: 'move_post', postId: 'p-aug-14', fromDate: '2026-08-14', toDate: '2026-08-22',
      amends: true, reason: 'make it the Saturday after',
    }] as ParsedTask[];
    const r = await ask('actually make it the Saturday after', ['pv-move']);

    expect(h.rejected).toEqual(['pv-move']);
    expect(r.supersededProposalIds).toEqual(['pv-move']);
    expect(h.createCalls[0]!.payload).toMatchObject({ kind: 'move', postId: 'p-aug-14', toDate: '2026-08-22' });
    expect(r.items[0]).toMatchObject({ action: 'move', fromDate: '2026-08-14', toDate: '2026-08-22' });
  });
});

describe('the prompt states the rule', () => {
  it('names the pending change as the referent, and the escape hatch', () => {
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('THE PENDING CHANGE IS THE REFERENT');
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('"amends": true');
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('PLAINLY names something else');
  });
});
