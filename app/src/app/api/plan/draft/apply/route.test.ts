/**
 * apply route test — the north-star path's dispatch layer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { clientId: string; cycleId: string } | null,
  applyTextToDraft: vi.fn(),
  addBacklogItemToMonth: vi.fn(),
  loadReceipts: vi.fn(),
  appendMessage: vi.fn(),
  ensureConversation: vi.fn(),
  owned: new Set<string>(),
  /** conversationId → the cycle it belongs to. Anything absent is another client's or another
   *  month's, and must not be adopted. */
  threadsFor: new Map<string, string>(),
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/agent/model', () => ({ getModelClient: () => ({ complete: async () => ({ content: '{}' }) }) }));
vi.mock('@/lib/draft-apply', () => ({
  applyTextToDraft:    (...a: unknown[]) => h.applyTextToDraft(...a),
  addBacklogItemToMonth: (...a: unknown[]) => h.addBacklogItemToMonth(...a),
  loadReceipts:          (...a: unknown[]) => h.loadReceipts(...a),
}));
// The route now writes the reshape into the per-cycle conversation (the sheet's thread).
vi.mock('@/lib/agent/conversation', () => ({
  ensureConversation: (...a: unknown[]) => { h.ensureConversation(...a); return Promise.resolve('conv-1'); },
  appendMessage: (...a: unknown[]) => h.appendMessage(...a),
  // Per-month threads: only the ids in `h.threadsFor` belong to the cycle they are asked about.
  conversationIsForCycle: async (_c: string, id: string, cycleId: string) =>
    h.threadsFor.get(id) === cycleId,
}));
// Ownership, as the read routes already ask it. Only the set below is this client's.
vi.mock('@/lib/agent/cycle-state', async (orig) => ({
  ...(await orig() as object),
  cycleBelongsToClient: async (_c: string, id: string) => h.owned.has(id),
  getCycleMonth: async () => '2026-09',
}));

import { GET, POST } from './route';

const CLIENT = 'client-1';
const CYCLE  = '11111111-1111-4111-8111-111111111111';
/** Another month of the SAME client — the one on screen. */
const VIEWED = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const APPLIED = {
  ok: true as const,
  application: { id: 'r-1', at: '2026-08-01T00:00:00Z', sourceText: 'x', scope: 'month_scoped', lines: ['Added: X, Mon 28 Sep'], changedIds: ['n1'] },
  beats: [{ id: 'n1' }],
};

const get = () => GET(new Request('http://x/api/plan/draft/apply'));

const post = (body: unknown) =>
  POST(new Request('http://x/api/plan/draft/apply', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  h.session = { clientId: CLIENT, cycleId: CYCLE };
  h.applyTextToDraft.mockReset().mockResolvedValue(APPLIED);
  h.addBacklogItemToMonth.mockReset().mockResolvedValue(APPLIED);
  h.loadReceipts.mockReset().mockResolvedValue([]);
  h.appendMessage.mockReset().mockResolvedValue('m-1');
  h.ensureConversation.mockReset();
  h.owned.clear(); h.owned.add(CYCLE); h.owned.add(VIEWED);
  h.threadsFor.clear();
});

/**
 * ── THE TURN JOINS THE SESSION IT BELONGS TO ─────────────────────────────────────────
 *
 * `ensureConversation` was called with two arguments, which since the per-session ruling
 * means "start a new one" — so every turn on a draft month opened its own conversation and
 * no correction ever had a previous turn to resolve against. 45 rows for 16 exchanges on
 * cycle 5ea00045. The id was being sent by the dock and discarded here.
 */
describe('the conversation is adopted, not re-opened every turn', () => {
  it('passes the sent conversation through to ensureConversation', async () => {
    h.threadsFor.set('conv-live', CYCLE);
    await post({ op: 'text', text: 'I only wanted one of those moving', conversationId: 'conv-live' });
    expect(h.ensureConversation).toHaveBeenCalledWith(CLIENT, CYCLE, 'conv-live');
  });

  it('starts a new one when the id belongs to ANOTHER MONTH — threads are per-month', async () => {
    h.threadsFor.set('conv-october', VIEWED);            // a stale id from the month just left
    await post({ op: 'text', text: 'no, the other one', conversationId: 'conv-october' });
    expect(h.ensureConversation).toHaveBeenCalledWith(CLIENT, CYCLE, undefined);
  });

  it('starts a new one when the id is not this client’s', async () => {
    await post({ op: 'text', text: 'move the launch', conversationId: 'conv-someone-else' });
    expect(h.ensureConversation).toHaveBeenCalledWith(CLIENT, CYCLE, undefined);
  });

  it('a non-string conversationId is ignored rather than forwarded', async () => {
    await post({ op: 'text', text: 'move the launch', conversationId: { id: 'x' } });
    expect(h.ensureConversation).toHaveBeenCalledWith(CLIENT, CYCLE, undefined);
  });

  it('echoes the conversation back so the sheet can hold it for the next turn', async () => {
    const res = await post({ op: 'text', text: 'move the launch' });
    expect((await res.json()).conversationId).toBe('conv-1');
  });
});

describe('auth', () => {
  it('refuses both verbs without a session', async () => {
    h.session = null;
    expect((await get()).status).toBe(401);
    expect((await post({ op: 'text', text: 'hello' })).status).toBe(401);
    expect(h.applyTextToDraft).not.toHaveBeenCalled();
  });
});

describe('op: text', () => {
  it('applies the input and returns the receipt with the refreshed beats', async () => {
    const res = await post({ op: 'text', text: 'The navy edit drops on the 28th' });
    expect(res.status).toBe(200);
    // conversationId rides along now (the conversation sheet) — the reshape is a thread turn.
    expect(await res.json()).toEqual({ ok: true, application: APPLIED.application, beats: APPLIED.beats, conversationId: 'conv-1' });
    expect(h.applyTextToDraft).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENT, cycleId: CYCLE, text: 'The navy edit drops on the 28th',
    }));
  });

  it('persists the exchange as thread turns — the client’s words, then the receipt’s own lines', async () => {
    await post({ op: 'text', text: 'The navy edit drops on the 28th' });
    expect(h.appendMessage).toHaveBeenCalledTimes(2);
    expect(h.appendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      role: 'user', content: 'The navy edit drops on the 28th',
    }));
    expect(h.appendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      role: 'assistant', content: 'Added: X, Mon 28 Sep',
    }));
  });

  it('a FAILED reshape persists nothing — the thread records what happened, not what didn’t', async () => {
    h.applyTextToDraft.mockResolvedValue({ ok: false, error: 'no_draft', message: 'x' });
    await post({ op: 'text', text: 'anything' });
    expect(h.appendMessage).not.toHaveBeenCalled();
  });

  it('defaults to the text op when none is given', async () => {
    await post({ text: 'more product this month' });
    expect(h.applyTextToDraft).toHaveBeenCalled();
  });

  /**
   * The contract SPLIT here, and the split is the point.
   *
   * This used to read "takes identity from the SESSION, never the body" and asserted that a
   * body-supplied cycleId was ignored. That is still true of WHO — clientId is the session's
   * and a body can never change it. It is deliberately no longer true of WHICH MONTH: the
   * viewed cycle now comes from the body, because the client can walk to a month their link
   * does not name. What protects that is ownership, not provenance — an id we cannot verify
   * is refused rather than quietly replaced with the session's.
   */
  it('takes the CLIENT from the session, never the body', async () => {
    await post({ op: 'text', text: 'x', clientId: 'someone-else', cycleId: VIEWED });
    expect(h.applyTextToDraft).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT, cycleId: VIEWED }));
  });

  it('refuses a body-supplied cycle it cannot verify, rather than silently using the session’s', async () => {
    const res = await post({ op: 'text', text: 'x', cycleId: 'their-cycle' });
    expect(res.status).toBe(403);
    expect(h.applyTextToDraft).not.toHaveBeenCalled();
  });

  it('rejects empty or whitespace-only text before calling anything', async () => {
    expect((await post({ op: 'text', text: '   ' })).status).toBe(400);
    expect((await post({ op: 'text' })).status).toBe(400);
    expect(h.applyTextToDraft).not.toHaveBeenCalled();
  });
});

describe('op: add_to_month', () => {
  it('promotes a backlog idea onto a date', async () => {
    const res = await post({ op: 'add_to_month', planInputId: 'pi-1', date: '2026-09-15' });
    expect(res.status).toBe(200);
    expect(h.addBacklogItemToMonth).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENT, cycleId: CYCLE, planInputId: 'pi-1', date: '2026-09-15',
    }));
  });

  it.each([
    ['a missing id',     { op: 'add_to_month', date: '2026-09-15' }],
    ['a missing date',   { op: 'add_to_month', planInputId: 'pi-1' }],
    ['a malformed date', { op: 'add_to_month', planInputId: 'pi-1', date: '15 Sept' }],
  ])('rejects %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(h.addBacklogItemToMonth).not.toHaveBeenCalled();
  });
});

describe('validation and error mapping', () => {
  it('rejects an unknown op', async () => {
    const res = await post({ op: 'approve', text: 'x' });   // approval is Build D
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_op');
  });

  it('survives a malformed body', async () => {
    const res = await POST(new Request('http://x/api/plan/draft/apply', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it.each([
    ['no_cycle',      404],
    ['no_draft',      409],
    ['cutoff_passed', 409],
  ])('%s → %i, with the message passed through', async (error, status) => {
    h.applyTextToDraft.mockResolvedValue({ ok: false, error, message: 'nope' });
    const res = await post({ op: 'text', text: 'x' });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error, message: 'nope' });
  });
});

describe('GET — receipts survive reload', () => {
  it('returns the cycle’s stored receipts', async () => {
    h.loadReceipts.mockResolvedValue([APPLIED.application]);
    const res = await get();
    expect(await res.json()).toEqual({ receipts: [APPLIED.application] });
    expect(h.loadReceipts).toHaveBeenCalledWith(CYCLE);
  });
});

/**
 * The cycle a write lands on.
 *
 * These posts used to carry no cycle, so every branch here took `session.cycleId` — the month
 * the magic link named. A client browsing November on a September link had their reshape,
 * their promoted idea, their receipt AND their conversation turn applied to September.
 */
describe('the write lands on the month the client is looking at', () => {
  it('op:text applies to the VIEWED cycle, not the session’s', async () => {
    await post({ op: 'text', text: 'move the launch', cycleId: VIEWED });
    expect(h.applyTextToDraft).toHaveBeenCalledWith(expect.objectContaining({ cycleId: VIEWED }));
  });

  it('op:add_to_month promotes into the VIEWED cycle', async () => {
    await post({ op: 'add_to_month', planInputId: 'pi-1', date: '2026-11-05', cycleId: VIEWED });
    expect(h.addBacklogItemToMonth).toHaveBeenCalledWith(expect.objectContaining({ cycleId: VIEWED }));
  });

  it('the thread is opened on the VIEWED cycle too — receipt and beats cannot land apart', async () => {
    await post({ op: 'text', text: 'move the launch', cycleId: VIEWED });
    // The third argument is the conversation to ADOPT; undefined here because none was sent.
    expect(h.ensureConversation).toHaveBeenCalledWith(CLIENT, VIEWED, undefined);
  });

  it('GET receipts reads the VIEWED cycle', async () => {
    await GET(new Request(`http://x/api/plan/draft/apply?cycleId=${VIEWED}`));
    expect(h.loadReceipts).toHaveBeenCalledWith(VIEWED);
  });

  it('falls back to the session’s cycle when none is sent — older callers still work', async () => {
    await post({ op: 'text', text: 'move the launch' });
    expect(h.applyTextToDraft).toHaveBeenCalledWith(expect.objectContaining({ cycleId: CYCLE }));
  });

  it('REFUSES another client’s cycle, and writes nothing', async () => {
    const res = await post({ op: 'text', text: 'move the launch', cycleId: FOREIGN });
    expect(res.status).toBe(403);
    expect(h.applyTextToDraft).not.toHaveBeenCalled();
  });

  it('REFUSES a malformed cycle rather than defaulting to the session’s', async () => {
    const res = await post({ op: 'text', text: 'move the launch', cycleId: 'not-a-uuid' });
    expect(res.status).toBe(403);
    expect(h.applyTextToDraft).not.toHaveBeenCalled();
  });

  it('refuses BEFORE the op is dispatched — an unknown op on a foreign cycle is still 403', async () => {
    const res = await post({ op: 'add_to_month', planInputId: 'pi-1', date: '2026-11-05', cycleId: FOREIGN });
    expect(res.status).toBe(403);
    expect(h.addBacklogItemToMonth).not.toHaveBeenCalled();
  });
});
