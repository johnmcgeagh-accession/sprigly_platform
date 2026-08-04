/**
 * pending-intent.test.ts — THE RASPBERRY LAUNCH (G1).
 *
 * The operator's screenshots, turn for turn:
 *
 *   CLIENT     I want to launch the raspberry set
 *   ASSISTANT  Is it new, or an existing one coming back?
 *   CLIENT     It's new. Angle is fresh, new-in.
 *   ASSISTANT  What format were you thinking?
 *   CLIENT     Reels
 *   ASSISTANT  What would you like to do with the reels?      ← the failure
 *
 * The last line is not a failure of understanding. Every turn was parsed on its own, so
 * "Reels" arrived as a complete utterance with no verb, no subject and no target — and the only
 * safe reading of that is "the client said a word", whose only safe response is to ask what
 * they mean. The launch three turns had been assembling existed nowhere the parser could see:
 * not in the digest (nothing created), not in PENDING (nothing proposed), and not in the thread
 * in any form an answer could attach to.
 *
 * ── What the thread actually sent, before this ───────────────────────────────────────
 *
 * The question text DID travel. `threadForParser` serialised the clarify's `unresolved` item —
 * but as `could not do: <question>` (conversation.ts, `lineOf`), which reads as an ask that was
 * DROPPED rather than one that is OPEN. Measured, not assumed:
 *
 *     CLIENT: I want to launch the raspberry set
 *     ASSISTANT: could not do: Is the raspberry set new, or an existing one coming back?
 *     CLIENT: It's new. Angle is fresh.
 *
 * Nothing there says a reply is outstanding, and nothing holds the slots already filled. Both
 * halves are fixed: a question serialises as `asked:`, and the assembly itself rides as a
 * structured PENDING INTENT block that answers merge into.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTask, PendingIntent } from './types';
import type { ParserContext } from './task-parser';
import type { ConversationTurn } from './conversation';

const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  contexts: [] as unknown[],
  createCalls: [] as Array<Record<string, unknown>>,
  appended: [] as Array<Record<string, unknown>>,
  turns: [] as unknown[],
}));

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, conversations: {}, agentMessages: {} }));
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({}), getEmbeddingClient: () => ({}) }));
vi.mock('@/lib/agent/catalogue', () => ({ loadProductIndex: async () => '- Raspberry set (RS01) — raspberry' }));
vi.mock('@/lib/agent/task-parser', async (orig) => ({
  ...(await orig<typeof import('./task-parser')>()),
  parseTasks: async (_t: string, ctx: unknown) => { h.contexts.push(ctx); return h.tasks; },
}));
vi.mock('@/lib/agent/cycle-state', async (orig) => {
  const real = await orig<typeof import('./cycle-state')>();
  const ROWS = [{ id: 'cyc-1', month: '2026-07', status: 'workbook_built' }];
  return {
    ...real,
    // X1a: the context seam reads the client's cycles through this one function.
    listClientCycles: async () => ROWS,
    getClientCycleMonths: async (_c: string, viewed: string) => real.describeCycles(ROWS, viewed),
    getCycleMonth: async () => real.planMonthOf('2026-07'),
  };
});
/** The REAL serialisers — this file is about what they emit — over a scripted turn list. */
vi.mock('@/lib/agent/conversation', async (orig) => {
  const real = await orig<typeof import('./conversation')>();
  return {
    ...real,
    ensureConversation: async () => 'conv-1',
    appendMessage: async (args: Record<string, unknown>) => { h.appended.push(args); return `msg-${h.appended.length}`; },
    listTurns: async () => h.turns as ConversationTurn[],
  };
});
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
vi.mock('@/lib/e2e-fake', () => ({ e2eTodayIso: () => '2026-08-10', e2eFakeEnabled: () => false }));

import { runPlanAgentTurn } from './turn';
import { threadForParser, latestPendingIntent, intentForParser } from './conversation';
import { TASK_PARSER_SYSTEM_PROMPT } from './task-parser';

const ask = (instruction: string) =>
  runPlanAgentTurn({ clientId: 'c1', cycleId: 'cyc-1', instruction, source: 'voice', conversationId: 'conv-1' });
const lastCtx = () => h.contexts[h.contexts.length - 1] as ParserContext;
/** The assistant turn this run persisted, as it will be read back next time. */
const persistedIntent = (): PendingIntent | undefined => {
  const assistant = h.appended.filter((a) => a['role'] === 'assistant');
  const meta = assistant[assistant.length - 1]?.['metadata'] as Record<string, unknown> | undefined;
  return meta?.['pendingIntent'] as PendingIntent | undefined;
};

/** The launch, half-built: subject and angle in, format and count still open. */
const HALF_BUILT: PendingIntent = {
  action: 'add_post',
  slots: { subject: 'the raspberry set', angle: 'fresh, new-in', format: null, count: null, date: null },
  question: 'What format were you thinking — reels, carousels, or single images?',
  asked: ['status', 'format'],
};

const turn = (over: Partial<ConversationTurn>): ConversationTurn => ({
  id: 'x', role: 'assistant', content: '', source: 'web', createdAt: '2026-08-10T09:00:00Z', ...over,
});

beforeEach(() => {
  h.tasks = []; h.contexts.length = 0; h.createCalls.length = 0;
  h.appended.length = 0; h.turns.length = 0;
});

describe('the thread stops calling a question a failure', () => {
  it('an open question serialises as ASKED, not as "could not do"', () => {
    const out = threadForParser([
      turn({ id: '1', role: 'user', content: 'I want to launch the raspberry set' }),
      turn({ id: '2', items: [{ kind: 'unresolved', question: 'Is it new, or an existing one coming back?' }] }),
    ]);
    expect(out).toContain('asked: "Is it new, or an existing one coming back?"');
    expect(out).not.toContain('could not do');
  });

  it('a genuine dead end still says so — the two states are different and the label says which', () => {
    const out = threadForParser([
      turn({ items: [{ kind: 'unresolved', question: 'Couldn’t map “sponsor the 10k” to a plan change.' }] }),
    ]);
    expect(out).toContain('could not do:');
    expect(out).not.toContain('asked:');
  });
});

describe('the intent rides into the next turn', () => {
  it('an assembling clarify persists its intent ON the turn, with the question the client SAW', async () => {
    h.tasks = [{
      action: 'clarify',
      question: 'What format were you thinking — reels, carousels, or single images?',
      intent: { action: 'add_post', slots: { subject: 'the raspberry set', angle: 'fresh, new-in' }, asked: ['status', 'format'] },
    }] as ParsedTask[];
    await ask('It’s new. Angle is fresh, new-in.');
    const stored = persistedIntent()!;
    expect(stored.action).toBe('add_post');
    expect(stored.slots.subject).toBe('the raspberry set');
    expect(stored.slots.angle).toBe('fresh, new-in');
    // The question is the one `cannot()` put on the screen — not whatever the model claimed.
    expect(stored.question).toBe('What format were you thinking — reels, carousels, or single images?');
    expect(stored.asked).toContain('format');
  });

  it('and the NEXT turn’s prompt carries it as its own block, ahead of everything else', async () => {
    h.turns = [turn({ pendingIntent: HALF_BUILT })];
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('Reels');
    const ctx = lastCtx();
    expect(ctx.intent, 'the utterance must arrive with the assembly attached').toBeTruthy();
    expect(ctx.intent).toContain('the raspberry set');
    expect(ctx.intent).toContain('fresh, new-in');
    expect(ctx.intent).toContain('YOUR LAST TURN ASKED');
    expect(ctx.intent).toContain('do not ask about these again');
  });

  it('a turn that RESOLVES carries no intent — nothing to clear, it dies with the turn that stopped asking', async () => {
    h.turns = [turn({ pendingIntent: HALF_BUILT })];
    h.tasks = [{ action: 'add_post', format: 'reel', instruction: 'Launch the raspberry set — fresh, new-in.', reason: 'three' }] as ParsedTask[];
    await ask('three');
    expect(persistedIntent()).toBeUndefined();
  });

  it('only the LAST assistant turn’s intent counts — an abandoned assembly is not resurrected', () => {
    const turns = [
      turn({ id: '1', pendingIntent: HALF_BUILT }),
      turn({ id: '2', role: 'user', content: 'actually, what’s on next week?' }),
      turn({ id: '3', items: [{ kind: 'unresolved', question: 'Nothing on next week.' }] }),
    ];
    expect(latestPendingIntent(turns)).toBeNull();
  });

  it('no intent anywhere → no block, and the prompt is exactly what it always was', async () => {
    h.turns = [turn({ items: [{ kind: 'idea', text: 'something' }] })];
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('hello');
    expect(lastCtx().intent).toBeUndefined();
  });
});

/**
 * THE FIXTURE THE BRIEF ASKS FOR: the screenshots' exact thread, driven end to end. The parser
 * is scripted (it is a model call), so what these prove is the MACHINERY around it — that at
 * the "Reels" turn the assembly is in front of the parser rather than absent, and that the turn
 * after it is an interpretation or the count question, never "what would you like to do with
 * the reels?".
 */
describe('THE RASPBERRY THREAD, turn by turn', () => {
  it('turn 1 — the launch ask opens the assembly', async () => {
    h.tasks = [{
      action: 'clarify', question: 'Is it new, or an existing one coming back?',
      intent: { action: 'add_post', slots: { subject: 'the raspberry set' }, asked: ['status'] },
    }] as ParsedTask[];
    const r = await ask('I want to launch the raspberry set');
    expect(r.items[0]).toMatchObject({ kind: 'unresolved' });
    expect(persistedIntent()!.slots.subject).toBe('the raspberry set');
  });

  it('turn 2 — the answer MERGES: the angle lands and the subject is still there', async () => {
    h.turns = [turn({ pendingIntent: { action: 'add_post', slots: { subject: 'the raspberry set' }, question: 'Is it new?', asked: ['status'] } })];
    h.tasks = [{
      action: 'clarify', question: 'What format were you thinking?',
      intent: { action: 'add_post', slots: { subject: 'the raspberry set', angle: 'fresh, new-in' }, asked: ['status', 'format'] },
    }] as ParsedTask[];
    await ask('It’s new. Angle is fresh, new-in.');
    const stored = persistedIntent()!;
    expect(stored.slots).toMatchObject({ subject: 'the raspberry set', angle: 'fresh, new-in' });
    expect(stored.asked).toEqual(['status', 'format']);
  });

  it('turn 3 — "Reels" arrives WITH the launch attached, so it can only be an answer', async () => {
    h.turns = [turn({ pendingIntent: HALF_BUILT })];
    h.tasks = [{ action: 'clarify', question: 'How many reels were you thinking?', intent: { ...HALF_BUILT, slots: { ...HALF_BUILT.slots, format: 'reel' }, asked: ['status', 'format', 'count'] } }] as ParsedTask[];
    await ask('Reels');

    // What the parser saw. Before this fix the whole of it was the word "Reels".
    const ctx = lastCtx();
    expect(ctx.intent).toContain('A add_post is being assembled');
    expect(ctx.intent).toContain('- subject: the raspberry set');
    expect(ctx.intent).toContain('- format: (not yet said)');

    // And the turn after it is the COUNT question — the last open slot — never a question
    // about what the reels are for.
    const stored = persistedIntent()!;
    expect(stored.slots.format).toBe('reel');
    expect(stored.question).toContain('How many');
    expect(stored.question).not.toMatch(/what would you like to do/i);
  });

  it('turn 4 — the count resolves it into an INTERPRETATION: three reels, one per post', async () => {
    h.turns = [turn({ pendingIntent: { ...HALF_BUILT, slots: { ...HALF_BUILT.slots, format: 'reel' }, question: 'How many reels?', asked: ['status', 'format', 'count'] } })];
    h.tasks = [
      { action: 'add_post', format: 'reel', instruction: 'Launch the raspberry set — fresh, new-in.', reason: 'three' },
      { action: 'add_post', format: 'reel', instruction: 'Launch the raspberry set — fresh, new-in.', reason: 'three' },
      { action: 'add_post', format: 'reel', instruction: 'Launch the raspberry set — fresh, new-in.', reason: 'three' },
    ] as ParsedTask[];
    const r = await ask('three');

    expect(r.proposals).toHaveLength(3);
    expect(r.items.every((i) => i.kind === 'change')).toBe(true);
    expect(r.items.every((i) => i.kind === 'change' && i.format === 'reel')).toBe(true);
    // No question survives into the interpretation turn.
    expect(r.items.some((i) => i.kind === 'unresolved')).toBe(false);
    expect(persistedIntent()).toBeUndefined();
  });
});

describe('THE SECOND FIXTURE: an amendment mid-assembly', () => {
  it('"actually make it the 19th" replaces the date and keeps every other slot', async () => {
    h.turns = [turn({ pendingIntent: { ...HALF_BUILT, slots: { ...HALF_BUILT.slots, format: 'reel', date: '2026-08-24' } } })];
    h.tasks = [{
      action: 'clarify', question: 'How many reels were you thinking?',
      intent: { action: 'add_post', slots: { subject: 'the raspberry set', angle: 'fresh, new-in', format: 'reel', date: '2026-08-19' }, asked: ['status', 'format', 'count'] },
    }] as ParsedTask[];
    await ask('actually make it the 19th');

    const stored = persistedIntent()!;
    expect(stored.slots.date).toBe('2026-08-19');
    expect(stored.slots.subject).toBe('the raspberry set');   // carried, not restarted
    expect(stored.slots.angle).toBe('fresh, new-in');
    expect(stored.slots.format).toBe('reel');
  });

  it('the amendment’s own context showed the OLD date, so the model had something to replace', async () => {
    h.turns = [turn({ pendingIntent: { ...HALF_BUILT, slots: { ...HALF_BUILT.slots, format: 'reel', date: '2026-08-24' } } })];
    h.tasks = [{ action: 'clarify', question: 'ok' }] as ParsedTask[];
    await ask('actually make it the 19th');
    expect(lastCtx().intent).toContain('- date: 2026-08-24');
  });
});

describe('the intent is validated, not trusted — it rides back into the next prompt', () => {
  it('an intent on a non-clarify task is dropped: an assembly must not outlive its question', async () => {
    h.tasks = [{ action: 'add_post', toDate: '2026-08-20', intent: HALF_BUILT }] as unknown as ParsedTask[];
    await ask('add something');
    expect(persistedIntent()).toBeUndefined();
  });

  it('the serialiser renders an empty slot as "(not yet said)" rather than as nothing', () => {
    const out = intentForParser({ action: 'add_post', slots: { subject: 'the raspberry set' } });
    expect(out).toContain('- subject: the raspberry set');
    expect(out).toContain('- count: (not yet said)');
  });

  it('no intent → the empty string, so the block is absent rather than blank', () => {
    expect(intentForParser(null)).toBe('');
  });
});

describe('the prompt states the rule and shows the failure it exists for', () => {
  it('the raspberry exchange is IN the prompt, with the failing line marked', () => {
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('What would you like to do with the reels?');
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('THE FAILURE');
  });

  it('a bare answer is named as an answer, and one question per slot is stated', () => {
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('ALWAYS an answer to the open question');
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('ALREADY ASKED ABOUT');
  });

  it('and the escape hatch survives — an unrelated utterance still breaks out', () => {
    expect(TASK_PARSER_SYSTEM_PROMPT).toContain('PLAINLY names a different intent');
  });
});
