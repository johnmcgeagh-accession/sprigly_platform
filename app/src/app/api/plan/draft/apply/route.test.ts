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
  ensureConversation: async () => 'conv-1',
  appendMessage: (...a: unknown[]) => h.appendMessage(...a),
}));

import { GET, POST } from './route';

const CLIENT = 'client-1';
const CYCLE  = 'cycle-1';
const APPLIED = {
  ok: true as const,
  application: { id: 'r-1', at: '2026-08-01T00:00:00Z', sourceText: 'x', scope: 'month_scoped', lines: ['Added: X, Mon 28 Sep'], changedIds: ['n1'] },
  beats: [{ id: 'n1' }],
};

const post = (body: unknown) =>
  POST(new Request('http://x/api/plan/draft/apply', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  h.session = { clientId: CLIENT, cycleId: CYCLE };
  h.applyTextToDraft.mockReset().mockResolvedValue(APPLIED);
  h.addBacklogItemToMonth.mockReset().mockResolvedValue(APPLIED);
  h.loadReceipts.mockReset().mockResolvedValue([]);
  h.appendMessage.mockReset().mockResolvedValue('m-1');
});

describe('auth', () => {
  it('refuses both verbs without a session', async () => {
    h.session = null;
    expect((await GET()).status).toBe(401);
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

  it('takes identity from the SESSION, never the body', async () => {
    await post({ op: 'text', text: 'x', clientId: 'someone-else', cycleId: 'their-cycle' });
    expect(h.applyTextToDraft).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT, cycleId: CYCLE }));
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
    const res = await GET();
    expect(await res.json()).toEqual({ receipts: [APPLIED.application] });
    expect(h.loadReceipts).toHaveBeenCalledWith(CYCLE);
  });
});
