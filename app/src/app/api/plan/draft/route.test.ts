/**
 * draft route test — the dispatch layer the 28 library tests do not reach.
 *
 * The mutations themselves are covered in draft-mutations.test.ts. What is only
 * exercised here: op parsing, required-field validation, the guard→HTTP status mapping,
 * and the rule that identity comes from the SESSION and never from the body.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { clientId: string; cycleId: string } | null,
  loadDraftBeats: vi.fn(),
  moveBeat: vi.fn(),
  swapFormat: vi.fn(),
  dropBeat: vi.fn(),
  addBeat: vi.fn(),
  reorderWithinDay: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/plan', () => ({ loadDraftBeats: (...a: unknown[]) => h.loadDraftBeats(...a) }));
vi.mock('@/lib/draft-mutations', () => ({
  moveBeat:         (...a: unknown[]) => h.moveBeat(...a),
  swapFormat:       (...a: unknown[]) => h.swapFormat(...a),
  dropBeat:         (...a: unknown[]) => h.dropBeat(...a),
  addBeat:          (...a: unknown[]) => h.addBeat(...a),
  reorderWithinDay: (...a: unknown[]) => h.reorderWithinDay(...a),
}));

import { GET, POST } from './route';

const CLIENT = 'client-1';
const CYCLE  = 'cycle-1';
const OK = { ok: true as const, beats: [{ id: 'beat-1' }] };

const post = (body: unknown) =>
  POST(new Request('http://x/api/plan/draft', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  h.session = { clientId: CLIENT, cycleId: CYCLE };
  for (const fn of [h.loadDraftBeats, h.moveBeat, h.swapFormat, h.dropBeat, h.addBeat, h.reorderWithinDay]) fn.mockReset();
  h.loadDraftBeats.mockResolvedValue([]);
  h.moveBeat.mockResolvedValue(OK);
  h.swapFormat.mockResolvedValue(OK);
  h.dropBeat.mockResolvedValue(OK);
  h.addBeat.mockResolvedValue(OK);
  h.reorderWithinDay.mockResolvedValue(OK);
});

describe('auth', () => {
  it('GET refuses without a session', async () => {
    h.session = null;
    expect((await GET(new Request('http://x/api/plan/draft'))).status).toBe(401);
  });

  it('POST refuses without a session, before parsing anything', async () => {
    h.session = null;
    expect((await post({ op: 'drop', postId: 'p1' })).status).toBe(401);
    expect(h.dropBeat).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('returns the cycle’s draft beats', async () => {
    h.loadDraftBeats.mockResolvedValue([{ id: 'beat-1' }]);
    const res = await GET(new Request('http://x/api/plan/draft'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ beats: [{ id: 'beat-1' }] });
    expect(h.loadDraftBeats).toHaveBeenCalledWith(CLIENT, CYCLE);
  });

  it('honours an explicit ?cycleId, still scoped to the session client', async () => {
    await GET(new Request('http://x/api/plan/draft?cycleId=other-cycle'));
    expect(h.loadDraftBeats).toHaveBeenCalledWith(CLIENT, 'other-cycle');
  });
});

describe('op dispatch', () => {
  it('move → moveBeat with the session client', async () => {
    await post({ op: 'move', postId: 'p1', date: '2026-09-10' });
    expect(h.moveBeat).toHaveBeenCalledWith(CLIENT, 'p1', '2026-09-10');
  });

  it('format → swapFormat', async () => {
    await post({ op: 'format', postId: 'p1', format: 'reel' });
    expect(h.swapFormat).toHaveBeenCalledWith(CLIENT, 'p1', 'reel');
  });

  it('drop → dropBeat', async () => {
    await post({ op: 'drop', postId: 'p1' });
    expect(h.dropBeat).toHaveBeenCalledWith(CLIENT, 'p1');
  });

  it('add → addBeat, with the cycle from the SESSION not the body', async () => {
    // A caller must not be able to plant a beat in a cycle they were not issued a link for.
    await post({ op: 'add', cycleId: 'someone-elses-cycle', date: '2026-09-10', format: 'reel', pillar: 'Home & Space' });
    expect(h.addBeat).toHaveBeenCalledWith(CLIENT, CYCLE, { date: '2026-09-10', format: 'reel', pillar: 'Home & Space' });
  });

  it('reorder → reorderWithinDay, filtering non-string ids', async () => {
    await post({ op: 'reorder', date: '2026-09-02', postIds: ['a', 42, 'b', null] });
    expect(h.reorderWithinDay).toHaveBeenCalledWith(CLIENT, CYCLE, '2026-09-02', ['a', 'b']);
  });

  it('returns the refreshed beat list on success', async () => {
    const res = await post({ op: 'drop', postId: 'p1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, beats: [{ id: 'beat-1' }] });
  });
});

describe('request validation', () => {
  it('rejects an unknown op', async () => {
    const res = await post({ op: 'approve', postId: 'p1' });   // approval is Build D
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_op');
  });

  it('rejects a missing op', async () => {
    expect((await post({ postId: 'p1' })).status).toBe(400);
  });

  it('survives a malformed body without throwing', async () => {
    const res = await POST(new Request('http://x/api/plan/draft', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it.each([
    ['move without postId',  { op: 'move', date: '2026-09-10' }],
    ['move without date',    { op: 'move', postId: 'p1' }],
    ['format without format',{ op: 'format', postId: 'p1' }],
    ['drop without postId',  { op: 'drop' }],
    ['add without date',     { op: 'add', format: 'reel', pillar: 'p' }],
    ['add without pillar',   { op: 'add', date: '2026-09-10', format: 'reel' }],
    ['reorder without ids',  { op: 'reorder', date: '2026-09-02', postIds: [] }],
  ])('rejects %s with 400 and calls no mutation', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    for (const fn of [h.moveBeat, h.swapFormat, h.dropBeat, h.addBeat, h.reorderWithinDay]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe('guard → HTTP status mapping', () => {
  // Each refusal is a different fact and gets a status the surface can act on:
  // 404 gone, 409 conflict (it moved on / the window closed), 422 you asked for
  // something invalid.
  it.each([
    ['not_found',      404],
    ['not_a_draft',    409],
    ['cutoff_passed',  409],
    ['read_only_date', 422],
    ['invalid_format', 422],
    ['invalid_pillar', 422],
  ])('%s → %i', async (error, status) => {
    h.moveBeat.mockResolvedValue({ ok: false, error, message: 'nope' });
    const res = await post({ op: 'move', postId: 'p1', date: '2026-09-10' });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error, message: 'nope' });
  });

  it('passes the human message through so the surface never invents its own', async () => {
    h.dropBeat.mockResolvedValue({ ok: false, error: 'cutoff_passed', message: 'This month’s draft is closed for changes.' });
    const res = await post({ op: 'drop', postId: 'p1' });
    expect((await res.json()).message).toBe('This month’s draft is closed for changes.');
  });

  it('falls back to 400 for an unrecognised error code', async () => {
    h.dropBeat.mockResolvedValue({ ok: false, error: 'something_new', message: 'x' });
    expect((await post({ op: 'drop', postId: 'p1' })).status).toBe(400);
  });
});
